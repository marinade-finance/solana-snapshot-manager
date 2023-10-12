# Marinade Snapshot API

## Installation

```bash
pnpm install --frozen-lockfile
```

## Running the CLI
```bash
export POSTGRES_URL=...
export RPC_URL=...
# preparing filters that are used while parsing snapshot by marinade-snapshot-etl
pnpm run cli -- filters --json-output filters.json
# parsing the pre-processed SQLite DB file produced by marinade-snapshot-etl
pnpm run cli -- parse --slot <number> --sqlite <input-sqlite> [--csv-output <csv-path>] [--psql-output]
pnpm run cli -- record-msol-votes
```

**NOTE 1:** The slot can be parsed from the snapshot file name.
For example with name `snapshot-221035708-5hm7mejai5LF1HEi5yiNjQSPoAvN9EqHtjnJ3Dai5m2y.tar.zst`
the snapshot is the number `221035708`, see [buildspec.yaml](./scraper/buildspec.yaml).

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
