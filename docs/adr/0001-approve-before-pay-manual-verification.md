# Approve bookings before payment, verify money by hand

**Status**: accepted (reads "the Admin" where it once said "the Host" — ADR-0007)

A Booking is reviewed and approved by the Admin *before* the Guest pays anything; payment is a bank transfer or e-wallet outside the system, claimed with an uploaded Payment proof and verified manually by the Admin. The alternative — taking money first, the way booking platforms normally do — was rejected because it creates a refund obligation for stays the Admin never accepted: with no payment gateway and no automated payouts, every rejection would become a manual refund of money the system should never have held. The cost of this decision is that the Admin is a required step in every booking, and that "Reserved" is the first status a Guest can truly rely on.
