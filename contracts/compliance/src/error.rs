use soroban_sdk::contracterror;

#[contracterror]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum Error {
    /// Contract has not been initialized with an admin yet.
    NotInitialized = 1,
    /// `initialize` called on an already-initialized contract.
    AlreadyInitialized = 2,
    /// No member registered for the given wallet.
    MemberNotFound = 3,
    /// No disclosure grant exists for the given id.
    GrantNotFound = 4,
    /// `expires_at` is in the past relative to the current ledger time.
    InvalidExpiry = 5,
    /// A specific-payout grant must reference a non-zero payout id; a
    /// whole-batch grant must use payout id 0.
    InvalidGrantTarget = 6,
}
