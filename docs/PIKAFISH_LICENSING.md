# Pikafish Licensing Notes

This note records the license split relevant to distributing this application.
It is not legal advice.

## Engine Program

Official Pikafish program source and binaries are released under GPLv3. The
official README explicitly permits selling and distributing the program. When
distributing a Pikafish binary, include GPLv3 and the complete corresponding
source for that exact binary, or a durable pointer to it. Modified Pikafish
source must also be made available under GPLv3.

Sources:

- `Pikafish.2026-01-02/README.md`, "Terms of use"
- `Pikafish.2026-01-02/Copying.txt`, GPLv3

## Official NNUE Weights

The official `pikafish.nnue` file is not covered by the above conclusion
alone. `NNUE-License.md` states that using the weights constitutes agreement
to its license and that commercial use requires permission. This also applies
to weights derived from the official Pikafish weights.

Therefore, do not bundle the official `pikafish.nnue` in a commercial desktop
release or use it for a commercial remote-analysis service without written
permission from the Pikafish rights holder. The published authorization list
is at <https://pikafish.org/list.html>; an unlisted product must not assume it
has authorization.

## Deployment Consequences

- A desktop package containing Pikafish needs GPLv3 distribution compliance.
- A package or server using official `pikafish.nnue` needs separate commercial
  permission for the weights.
- GPLv3 does not by itself treat ordinary network interaction without sending
  a copy as distribution, but this does not remove the NNUE weights' separate
  commercial-use restriction.
- The official NNUE license notes that Fairy-Stockfish's xiangqi NNUE weights
  are CC0. Verify the exact source, hash, engine compatibility and performance
  before treating them as a replacement.
