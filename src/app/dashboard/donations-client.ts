import { DonationDoc, DonationPatch, EMPTY_DONATION_DOC, SyncKeys, donationDocSchema } from "@swdi/shared";

// Client for the plaintext donation-config store. Same id and bearer token as sync;
// an absent doc reads as empty, and network trouble degrades to empty rather than
// blocking the reading views.

export async function fetchDonationDoc(keys: SyncKeys): Promise<DonationDoc> {
  try {
    const response = await fetch(`/api/donations/${keys.syncId}`, { headers: { authorization: `Bearer ${keys.authToken}` } });
    if (!response.ok) return EMPTY_DONATION_DOC;

    const parsed = donationDocSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : EMPTY_DONATION_DOC;
  } catch {
    return EMPTY_DONATION_DOC;
  }
}

export async function putDonationDoc(keys: SyncKeys, doc: DonationDoc): Promise<boolean> {
  try {
    const response = await fetch(`/api/donations/${keys.syncId}`, {
      method:  "PUT",
      headers: { authorization: `Bearer ${keys.authToken}`, "content-type": "application/json" },
      body:    JSON.stringify(doc),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Send one edit op; the response is the server's updated doc, or null on failure. */
export async function patchDonationDoc(keys: SyncKeys, patch: DonationPatch): Promise<DonationDoc | null> {
  try {
    const response = await fetch(`/api/donations/${keys.syncId}`, {
      method:  "PATCH",
      headers: { authorization: `Bearer ${keys.authToken}`, "content-type": "application/json" },
      body:    JSON.stringify(patch),
    });
    if (!response.ok) return null;

    const parsed = donationDocSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
