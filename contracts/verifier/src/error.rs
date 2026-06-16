use soroban_sdk::contracterror;

#[contracterror]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum Error {
    /// Contract has not been initialized with an admin.
    NotInitialized = 1,
    /// `initialize` called twice.
    AlreadyInitialized = 2,
    /// No verifying key has been registered yet.
    VkNotSet = 3,
    /// `ic` length must equal `public_inputs.len() + 1`.
    PublicInputLenMismatch = 4,
    /// A verifying key must carry at least the IC_0 constant term.
    EmptyVerifyingKey = 5,
}
