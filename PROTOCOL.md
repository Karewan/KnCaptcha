# KnCaptcha protocol, version 2

What the server and the browser exchange, and how a solution is checked. The JavaScript library
([KnCaptcha](https://github.com/Karewan/KnCaptcha)) and the PHP library
([KnCaptchaPhp](https://github.com/Karewan/KnCaptchaPhp)) implement it; another server only needs SHA-256 and
HMAC-SHA256.

Notation: `||` concatenates bytes, `LE32(x)` and `BE32(x)` write a 32-bit unsigned integer in little or big endian,
`u8(x)` writes one byte, `B64U` is base64url without padding (RFC 4648 §5). Bits are numbered from the most
significant bit of the first byte.

## Overview

1. The server issues a **challenge**: a random salt, the puzzle parameters and an expiry, signed with an HMAC. It stores
   nothing.
2. The browser finds, for each of the `p` **proofs**, a nonce and an Equihash solution whose hash starts with `d` zero
   bits.
3. The server checks the signature, the expiry, then each proof (2^k + 2 SHA-256), and last marks the challenge as used
   (the salt, until the expiry). A solution passes once.

## Equihash

Equihash(n, k) (Biryukov & Khovratovich, *Equihash: asymmetric proof-of-work based on the generalized birthday
problem*, NDSS 2016) is a memory-hard puzzle whose solutions are checked with 2^k hashes. With `c = n / (k + 1)`:

- there are `2^(c+1)` leaves; leaf `i` has an n-bit hash `X(i)`,
- a solution is a list of `2^k` leaf indices `i(1) … i(2^k)`, all distinct, such that for each level `l` from 1 to `k`,
  for each aligned group of `2^l` indices:
  - the XOR of their hashes is zero on its first `l·c` bits, and on all `n` bits at level `k`,
  - the first index of the left half is lower than the first index of the right half.

The last condition gives each solution a single order. Wagner's algorithm finds about 2 solutions per seed, holding the
`2^(c+1)` hashes in memory.

Supported parameters: `2 ≤ k ≤ 7`, `n` a multiple of `k + 1`, `8 ≤ c ≤ 20`. Default: Equihash(96, 5), `c = 16`, 131 072
leaves, about 10 MB and 40 ms per run on a desktop core.

### Leaf hashes

With `L = ceil(n / 8)` bytes per leaf and `P = floor(32 / L)` leaves per digest:

```
digest(g) = SHA-256(seed || LE32(g))
X(i)      = the first n bits of digest(floor(i / P))[(i mod P)·L … (i mod P)·L + L - 1]
```

Bits after the `n`-th are never looked at.

## Challenge

The payload has 32 bytes:

| Offset | Size | Field                                          |
|-------:|-----:|------------------------------------------------|
|      0 |    1 | version, `2`                                   |
|      1 |    1 | `n`                                            |
|      2 |    1 | `k`                                            |
|      3 |    1 | `d`: leading zero bits per proof, 0 to 24      |
|      4 |    1 | `p`: number of proofs, 1 to 8                  |
|      5 |    3 | zero                                           |
|      8 |    4 | `BE32(issued at)`, Unix time in seconds        |
|     12 |    4 | `BE32(expires at)`                             |
|     16 |   16 | salt, random                                   |

```
mac       = HMAC-SHA256(secret, "kncaptcha/v2" || payload || scope)
challenge = B64U(payload) || "." || B64U(mac)
```

`scope` is a free string chosen by the server (form name, IP address…), never sent: the same scope must be given to the
verification. The payload has a fixed length, so nothing can move between the payload and the scope. The secret has at
least 32 bytes.

The challenge endpoint answers the challenge as JSON, `{"challenge": "…"}`, or as plain text.

## Solution

For each proof `j` from 0 to `p - 1`, the browser tries nonces from 0:

```
seed(j, nonce) = SHA-256("kncaptcha/v2" || payload || mac || u8(j) || LE32(nonce))
```

until Equihash(n, k) on that seed gives a solution `i(1) … i(2^k)` such that

```
SHA-256(seed || LE32(i(1)) || … || LE32(i(2^k)))
```

starts with `d` zero bits. The seed depends on the MAC, so on the server secret: no work can start before the challenge
is issued, and each proof belongs to its position.

```
proof(j)  = LE32(nonce) || LE32(i(1)) || … || LE32(i(2^k))
solution  = challenge || "." || B64U(proof(0) || … || proof(p - 1))
```

With the default difficulty (2 proofs of Equihash(96, 5)) a solution has 440 characters.

## Verification

In this order, the cheapest checks first:

1. Refuse a solution longer than 6000 characters, without exactly three parts, whose parts are not canonical base64url
   (no padding, no other character, unused trailing bits at zero), whose payload is not 32 bytes or MAC not 32 bytes:
   `malformed`.
2. Compare the MAC with `HMAC-SHA256(secret, "kncaptcha/v2" || payload || scope)` in constant time: `bad_signature`.
3. Refuse another version: `malformed`.
4. Refuse when `now ≥ expires at`: `expired`.
5. Refuse when the proofs are not exactly `p × (1 + 2^k) × 4` bytes: `malformed`.
6. For each proof, check the indices (range, distinct), the Equihash conditions and the zero bits: `invalid_proof`.
7. Store the salt (32 hexadecimal characters) until the expiry, atomically, only if it is not stored yet; otherwise
   `replayed`.

Only a valid solution reaches the store: issuing challenges and sending wrong solutions writes nothing.

## Costs

| Step                                  | Server                                     | Browser                              |
|---------------------------------------|--------------------------------------------|--------------------------------------|
| Challenge                             | 16 random bytes, 1 HMAC, no storage        |                                      |
| Solution, default difficulty          | 1 HMAC, 68 SHA-256, 1 store write          | about 32 runs of Equihash(96, 5)     |

Each difficulty bit doubles the browser work. The number of runs follows a geometric law per proof: several proofs make
the solving time more regular, each one adds `2^k + 2` hashes to the verification.
