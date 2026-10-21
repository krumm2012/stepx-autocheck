from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from checkin_core import JobKey, Ledger


class LedgerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'ledger.db'
        self.ledger = Ledger(self.path)
        self.key = JobKey('device-1', 'account-hash', 'example.target', '2026-10-21')

    def tearDown(self):
        self.ledger.close()
        self.tmp.cleanup()

    def proof(self):
        return dict(kind='daily_status', date=self.key.business_date,
                    account=self.key.account, package=self.key.package, completed=True)

    def test_concurrent_cloud_and_alarm_have_one_owner(self):
        def trigger(_):
            ledger = Ledger(self.path)
            try:
                return ledger.reserve(self.key)
            finally:
                ledger.close()
        with ThreadPoolExecutor(max_workers=2) as pool:
            owners = list(pool.map(trigger, range(2)))
        self.assertEqual(sum(owner is not None for owner in owners), 1)

    def test_crash_after_click_requires_review_and_blocks_retry(self):
        owner = self.ledger.reserve(self.key)
        self.ledger.transition(self.key, owner, 'RESERVED', 'CLICK_INTENT')
        self.ledger.close()
        self.ledger = Ledger(self.path)
        self.ledger.recover_after_restart()
        self.assertEqual(self.ledger.state(self.key), 'NEEDS_REVIEW')
        self.assertIsNone(self.ledger.reserve(self.key))
        self.assertEqual(len(self.ledger.pending_events()), 1)
        self.ledger.transition(self.key, owner, 'NEEDS_REVIEW', 'SUCCESS', self.proof())
        self.assertEqual(self.ledger.state(self.key), 'SUCCESS')

    def test_crash_before_click_can_retry_but_stale_owner_cannot_act(self):
        old_owner = self.ledger.reserve(self.key)
        self.ledger.recover_after_restart()
        new_owner = self.ledger.reserve(self.key)
        self.assertNotEqual(old_owner, new_owner)
        with self.assertRaises(RuntimeError):
            self.ledger.transition(self.key, old_owner, 'RESERVED', 'CLICK_INTENT')

    def test_balance_or_wrong_account_is_not_success(self):
        owner = self.ledger.reserve(self.key)
        self.ledger.transition(self.key, owner, 'RESERVED', 'CLICK_INTENT')
        for evidence in [dict(kind='balance', delta=20),
                         dict(self.proof(), account='another-account'),
                         dict(self.proof(), date='2026-10-20'),
                         dict(self.proof(), completed=False)]:
            with self.assertRaises(ValueError):
                self.ledger.transition(self.key, owner, 'CLICK_INTENT', 'SUCCESS', evidence)
        self.assertEqual(self.ledger.state(self.key), 'CLICK_INTENT')

    def test_success_and_receipt_survive_restart_without_reexecution(self):
        owner = self.ledger.reserve(self.key)
        self.ledger.transition(self.key, owner, 'RESERVED', 'CLICK_INTENT')
        self.ledger.transition(self.key, owner, 'CLICK_INTENT', 'SUCCESS', self.proof())
        event = self.ledger.pending_events()[0]
        self.ledger.close()
        self.ledger = Ledger(self.path)
        self.assertIsNone(self.ledger.reserve(self.key))
        self.assertEqual(self.ledger.pending_events()[0], event)
        self.ledger.acknowledge(event[0])
        self.assertEqual(self.ledger.pending_events(), [])

    def test_already_done_is_distinct_from_new_reward(self):
        owner = self.ledger.reserve(self.key)
        self.ledger.transition(self.key, owner, 'RESERVED', 'ALREADY_DONE', self.proof())
        self.assertEqual(self.ledger.state(self.key), 'ALREADY_DONE')
        self.assertIsNone(self.ledger.reserve(self.key))

    def test_new_day_and_account_do_not_share_key(self):
        self.ledger.reserve(self.key)
        self.assertIsNotNone(self.ledger.reserve(
            JobKey('device-1', 'account-hash', 'example.target', '2026-10-22')))
        self.assertIsNotNone(self.ledger.reserve(
            JobKey('device-1', 'other-account', 'example.target', '2026-10-21')))


if __name__ == '__main__':
    unittest.main()
