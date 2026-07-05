CREATE TABLE "donation_configs" (
	"sync_id" text PRIMARY KEY NOT NULL,
	"auth_hash" text NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
