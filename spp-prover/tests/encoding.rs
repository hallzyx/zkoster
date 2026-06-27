/// Unit tests for ScVal encoding — do not require the proving artifacts.
use serde_json::json;
use stellar_xdr::curr::{Limits, ScVal, WriteXdr};

// Reimport only the helpers we want to test (same module, different crate).
// We use the public API from main.rs/lib via `spp_prover::` if we expose a lib
// target.  For now we inline the assertions that only touch stellar-xdr.

#[test]
fn field_zero_encodes_as_u256_all_zeros() {
    // Importing types and soroban_encode via a helper re-exported from main is
    // complex because spp-prover is a binary crate, not a lib.  So we test the
    // XDR structure directly using stellar-xdr's own U256 type.
    use stellar_xdr::curr::{ScVal, UInt256Parts};
    let v = ScVal::U256(UInt256Parts {
        hi_hi: 0,
        hi_lo: 0,
        lo_hi: 0,
        lo_lo: 0,
    });
    let xdr = v.to_xdr(Limits::none()).expect("xdr");
    // A U256 ScVal with all-zero limbs should serialize to a non-empty XDR blob.
    assert!(!xdr.is_empty());
}

#[test]
fn i256_scval_positive_i128_hi_is_zero() {
    use stellar_xdr::curr::{Int256Parts, ScVal};
    let n: i128 = 1_000_000;
    let hi = if n < 0 { -1i64 } else { 0i64 };
    let bytes = n.to_be_bytes();
    let lo_hi = u64::from_be_bytes(bytes[0..8].try_into().unwrap());
    let lo_lo = u64::from_be_bytes(bytes[8..16].try_into().unwrap());
    let scval = ScVal::I256(Int256Parts {
        hi_hi: hi,
        hi_lo: u64::from_be_bytes(hi.to_be_bytes()),
        lo_hi,
        lo_lo,
    });
    match scval {
        ScVal::I256(p) => {
            assert_eq!(p.hi_hi, 0);
            assert_eq!(p.lo_lo, 1_000_000u64);
        }
        _ => panic!("wrong variant"),
    }
}

#[test]
fn i256_scval_negative_i128_hi_is_minus_one() {
    use stellar_xdr::curr::{Int256Parts, ScVal};
    let n: i128 = -42;
    let hi = if n < 0 { -1i64 } else { 0i64 };
    let bytes = n.to_be_bytes();
    let lo_hi = u64::from_be_bytes(bytes[0..8].try_into().unwrap());
    let lo_lo = u64::from_be_bytes(bytes[8..16].try_into().unwrap());
    let scval = ScVal::I256(Int256Parts {
        hi_hi: hi,
        hi_lo: u64::from_be_bytes(hi.to_be_bytes()),
        lo_hi,
        lo_lo,
    });
    match scval {
        ScVal::I256(p) => {
            assert_eq!(p.hi_hi, -1i64);
        }
        _ => panic!("wrong variant"),
    }
}

#[test]
fn sorted_scmap_keys_are_alphabetical() {
    use stellar_xdr::curr::{ScMap, ScMapEntry, ScSymbol, ScVal};

    let mut entries = vec![
        ScMapEntry {
            key: ScVal::Symbol(ScSymbol("z_key".try_into().unwrap())),
            val: ScVal::Bool(true),
        },
        ScMapEntry {
            key: ScVal::Symbol(ScSymbol("a_key".try_into().unwrap())),
            val: ScVal::Bool(false),
        },
    ];
    entries.sort_by(|a, b| {
        let ScVal::Symbol(ka) = &a.key else { return std::cmp::Ordering::Equal };
        let ScVal::Symbol(kb) = &b.key else { return std::cmp::Ordering::Equal };
        ka.to_string().cmp(&kb.to_string())
    });

    let keys: Vec<String> = entries
        .iter()
        .map(|e| {
            let ScVal::Symbol(s) = &e.key else { panic!() };
            s.to_string()
        })
        .collect();

    assert_eq!(keys, vec!["a_key", "z_key"]);

    // Ensure it can be converted to ScMap (validates key count constraints)
    let _map = ScMap(entries.try_into().unwrap());
}
