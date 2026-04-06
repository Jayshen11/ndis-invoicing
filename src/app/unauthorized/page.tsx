import type { Metadata } from "next";
import { UnauthorizedPage } from "@/modules/auth/components/UnauthorizedPage";

export const metadata: Metadata = {
  title: "Not authorised",
};

export const dynamic = "force-dynamic";

export default function UnauthorizedRoutePage() {
  return <UnauthorizedPage />;
}
