CREATE TABLE "sync_blobs" (
	"sync_id" text PRIMARY KEY NOT NULL,
	"auth_hash" text NOT NULL,
	"version" integer NOT NULL,
	"iv" text NOT NULL,
	"data" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
