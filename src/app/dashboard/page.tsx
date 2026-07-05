import type { Metadata } from "next";
import { DashboardClient } from "./DashboardClient";

export const metadata: Metadata = {
  title: "Your reading, SWDI",
  description: "Your reading, decrypted in your browser. The server only ever sees ciphertext.",
};

export default function DashboardPage() {
  return <DashboardClient />;
}
