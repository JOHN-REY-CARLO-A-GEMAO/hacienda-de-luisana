# Date-hold expiry is a read-time rule, not a scheduled sweep

**Status**: accepted (reads "the Admin" where it once said "the Host" — ADR-0007)

A Booking's 24-hour Date hold is enforced when availability is read, not by a scheduled job that expires stale holds. The project has no deployed Cloud Functions and the Firebase project is not on a plan that would run one, so a sweep would have meant new backend infrastructure and a human deploy step before a single hold could expire. The consequence to remember: **nothing in the backend ever releases a hold**, so every surface that answers "is this Accommodation free?" — the guest availability check, the Admin's list, and above all the approval-time re-check — must apply the same overlap rule against stored Bookings, and the approval re-check is the last line of defence against a double-booking. If a scheduled sweep is ever added, this rule stays as the fallback rather than being replaced.
