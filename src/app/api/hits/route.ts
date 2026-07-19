import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

export const runtime = "nodejs";

// Unique visitors (HyperLogLog) + total fights started. Degrades gracefully to
// null counts when Upstash isn't configured, so the counter simply hides.
function redis(): Redis | null {
  // support both Upstash-native and Vercel KV env var names
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  try {
    return new Redis({ url, token });
  } catch {
    return null;
  }
}

const VKEY = "pit:visitors";
const FKEY = "pit:fights";

async function counts(r: Redis) {
  const [visitors, fights] = await Promise.all([r.pfcount(VKEY), r.get<number>(FKEY)]);
  return { visitors: visitors ?? 0, fights: Number(fights ?? 0) };
}

export async function GET() {
  const r = redis();
  if (!r) return NextResponse.json({ visitors: null, fights: null });
  try {
    return NextResponse.json(await counts(r), { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ visitors: null, fights: null });
  }
}

export async function POST(req: NextRequest) {
  const r = redis();
  if (!r) return NextResponse.json({ visitors: null, fights: null });
  try {
    const body = (await req.json().catch(() => ({}))) as { type?: string; id?: string };
    if (body.type === "visit" && typeof body.id === "string" && body.id.length <= 64) {
      await r.pfadd(VKEY, body.id);
    } else if (body.type === "fight") {
      await r.incr(FKEY);
    }
    return NextResponse.json(await counts(r), { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ visitors: null, fights: null });
  }
}
