"""Local reference model only: no Android actions, networking or scheduling.

A single device actor must own all UI work. After a process restart, the caller
must confirm the previous actor has stopped before calling recover_after_restart.
SQLite transactions protect reservation; they cannot make an external UI atomic.
"""
from dataclasses import dataclass
from datetime import date
import json
import sqlite3
from uuid import uuid4


@dataclass(frozen=True)
class JobKey:
    device: str
    account: str  # stable, pseudonymous identifier, never a phone number
    package: str
    business_date: str  # derived upstream using the configured business timezone

    def encode(self):
        date.fromisoformat(self.business_date)
        if not all((self.device, self.account, self.package)):
            raise ValueError("device/account/package must be known before reservation")
        return json.dumps([self.device, self.account, self.package, self.business_date])


class Ledger:
    def __init__(self, path):
        self.db = sqlite3.connect(path, timeout=5)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS jobs (
                job_key TEXT PRIMARY KEY,
                owner TEXT NOT NULL,
                state TEXT NOT NULL,
                attempt INTEGER NOT NULL,
                evidence TEXT
            );
            CREATE TABLE IF NOT EXISTS outbox (
                event_id TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                acked INTEGER NOT NULL DEFAULT 0
            );
        ''')

    def close(self):
        self.db.close()

    def reserve(self, key):
        """Returns an owner token, or None if already reserved/uncertain/completed."""
        encoded, owner = key.encode(), uuid4().hex
        try:
            self.db.execute("BEGIN IMMEDIATE")
            row = self.db.execute(
                "SELECT state, attempt FROM jobs WHERE job_key=?", (encoded,)
            ).fetchone()
            if row and row[0] != "RETRYABLE":
                self.db.rollback()
                return None
            attempt = row[1] + 1 if row else 1
            self.db.execute('''
                INSERT INTO jobs VALUES (?, ?, 'RESERVED', ?, NULL)
                ON CONFLICT(job_key) DO UPDATE SET owner=excluded.owner,
                    state='RESERVED', attempt=excluded.attempt, evidence=NULL
            ''', (encoded, owner, attempt))
            self.db.commit()
            return owner
        except Exception:
            self.db.rollback()
            raise

    def transition(self, key, owner, expected, target, evidence=None):
        """Guard state and attempt ownership; journal results with the state change."""
        allowed = {
            ("RESERVED", "CLICK_INTENT"),
            ("RESERVED", "RETRYABLE"),
            ("RESERVED", "ALREADY_DONE"),
            ("CLICK_INTENT", "SUCCESS"),
            ("CLICK_INTENT", "NEEDS_REVIEW"),
            ("NEEDS_REVIEW", "SUCCESS"),
        }
        if (expected, target) not in allowed:
            raise ValueError("invalid transition")
        if target in {"SUCCESS", "ALREADY_DONE"}:
            if not evidence or evidence.get("kind") != "daily_status":
                raise ValueError("authoritative daily-status evidence is required")
            if evidence.get("date") != key.business_date or evidence.get("account") != key.account:
                raise ValueError("evidence belongs to another day/account")
            if evidence.get("package") != key.package or evidence.get("completed") is not True:
                raise ValueError("evidence must identify completed status in the target app")
        encoded = key.encode()
        with self.db:
            changed = self.db.execute('''
                UPDATE jobs SET state=?, evidence=?
                WHERE job_key=? AND owner=? AND state=?
            ''', (target, json.dumps(evidence), encoded, owner, expected)).rowcount
            if changed != 1:
                raise RuntimeError("stale owner or unexpected state")
            if target in {"SUCCESS", "ALREADY_DONE", "NEEDS_REVIEW"}:
                attempt = self.db.execute(
                    "SELECT attempt FROM jobs WHERE job_key=?", (encoded,)
                ).fetchone()[0]
                event_id = json.dumps([encoded, attempt, target])
                payload = json.dumps({"eventId": event_id, "key": json.loads(encoded),
                                      "status": target, "evidence": evidence})
                self.db.execute("INSERT INTO outbox VALUES (?, ?, 0)", (event_id, payload))

    def recover_after_restart(self):
        """Exclusive startup only. Never retry an action whose outcome is unknown.

        Recovered CLICK_INTENT entries retain their owner token for reconciliation.
        A real adapter must enumerate them and only *read* the authoritative status.
        """
        with self.db:
            self.db.execute("UPDATE jobs SET state='RETRYABLE' WHERE state='RESERVED'")
            rows = self.db.execute(
                "SELECT job_key, owner FROM jobs WHERE state='CLICK_INTENT'"
            ).fetchall()
            for encoded, owner in rows:
                self.transition(JobKey(*json.loads(encoded)), owner,
                                "CLICK_INTENT", "NEEDS_REVIEW",
                                {"reason": "process_interrupted_after_click_intent"})

    def state(self, key):
        row = self.db.execute("SELECT state FROM jobs WHERE job_key=?", (key.encode(),)).fetchone()
        return row[0] if row else None

    def pending_events(self):
        return self.db.execute("SELECT event_id, payload FROM outbox WHERE acked=0").fetchall()

    def acknowledge(self, event_id):
        # Call only after the server confirms durable acceptance of this event ID.
        with self.db:
            self.db.execute("UPDATE outbox SET acked=1 WHERE event_id=?", (event_id,))
