# Marinade Snapshot API

## Installation

```bash
pnpm install --frozen-lockfile
```

## Running the CLI
```bash
export POSTGRES_URL=...
export RPC_URL=...
# preparing filters that are used while parsing snapshot by solana-snapshot-parser
pnpm run cli -- filters --json-output filters.json
# parsing the pre-processed SQLite DB file produced by snapshot-parser-tokens-cli
pnpm run cli -- parse --slot <number> --sqlite <input-sqlite> [--csv-output <csv-path>] [--psql-output]
pnpm run cli -- record-msol-votes
```

**NOTE 1:** The slot is the slot of the bank the parser loaded, which is not derivable from the
full snapshot's file name when an incremental snapshot is applied on top. Get it by running
`snapshot-parser-tokens-cli` with `--output-slot <path>` and reading that file,
see [buildkite.yaml](./scraper/buildkite.yaml).

**NOTE 2:** Before execution of the `parse` command on the sqlite database consider creating
additional indexes as defined in [index-db.bash](./index-db.bash).

## Running the app

```bash
# development
$ pnpm run start

# watch mode
$ pnpm run start:dev

# production mode
$ pnpm run start:prod
```

## Test

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e

# test coverage
$ pnpm run test:cov
```
