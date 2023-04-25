CREATE TABLE snapshots (
    snapshot_id SERIAL NOT NULL PRIMARY KEY,
    slot NUMERIC NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE msol_holders (
    snapshot_id SERIAL NOT NULL,
    owner TEXT NOT NULL,

    amount NUMERIC NOT NULL,
    sources TEXT[] NOT NULL,
    amounts NUMERIC[] NOT NULL,

    PRIMARY KEY (snapshot_id, owner),
    CONSTRAINT fk_snapshot FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id)
);
