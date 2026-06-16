use soroban_sdk::contracterror;

#[contracterror]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    BatchNotFound = 3,
    PayoutNotFound = 4,
    /// Batch is not in the status required for this transition.
    InvalidBatchStatus = 5,
    /// Payout is not in the status required for this transition.
    InvalidPayoutStatus = 6,
    /// Recipient is not authorized in the compliance contract (rule #3).
    EmployeeNotAuthorized = 7,
    /// A batch cannot be reviewed/approved with zero payouts.
    EmptyBatch = 8,
    /// Σ payout commitments != batch total commitment (rule #5).
    CommitmentSumMismatch = 9,
    /// The payout range proof failed verification.
    ProofInvalid = 10,
    /// Payout already settled — re-execution is forbidden (rule #4).
    PayoutAlreadyExecuted = 11,
    /// Payout does not belong to the referenced batch.
    BatchPayoutMismatch = 12,
}
