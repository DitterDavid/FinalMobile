import { NextResponse } from 'next/server';
import { errorResponse, requireUser } from '@/server/http';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try { const token = await requireUser(request); return NextResponse.json({ usuario: { id: token.uid, email: token.email ?? null } }); }
  catch (error) { return errorResponse(error); }
}
