import { NextResponse } from "next/server";
import { folderList } from "@/lib/traces";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  // Real folders only — drop "Unfiled" sentinel; the UI handles "no folder"
  // as the implicit default.
  const folders = folderList()
    .filter((f) => f.name !== "Unfiled")
    .map((f) => ({ name: f.name, count: f.count }));
  return NextResponse.json({ folders });
}
