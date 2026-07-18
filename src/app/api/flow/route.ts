import { NextRequest, NextResponse } from "next/server";
import { getFlow } from "@/lib/rhc/flow";

export const runtime = "nodejs";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const sinceParam = req.nextUrl.searchParams.get("since");
  const since = sinceParam ? BigInt(sinceParam) : undefined;
  try {
    const flow = await getFlow(since);
    return NextResponse.json(flow, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "flow read failed" },
      { status: 502 },
    );
  }
}
