import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

export interface GoogleClaims extends JWTPayload {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

const keySets = new Map<string, JWTVerifyGetKey>();

export function remoteKeys(url: string): JWTVerifyGetKey {
  let keys = keySets.get(url);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(url));
    keySets.set(url, keys);
  }
  return keys;
}

/** The token is malformed, forged, expired, meant for someone else, or lacks a verified email. */
export class InvalidTokenError extends Error {}

export async function verifyGoogleJwt(
  token: string,
  audience: string | string[],
  keys: JWTVerifyGetKey,
): Promise<GoogleClaims & { email: string }> {
  let claims: GoogleClaims;
  try {
    ({ payload: claims } = await jwtVerify<GoogleClaims>(token, keys, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience,
      algorithms: ["RS256"],
      requiredClaims: ["sub", "exp"],
      clockTolerance: 60,
    }));
  } catch (err) {
    if (err instanceof errors.JOSEError) throw new InvalidTokenError(err.code);
    throw err;
  }
  if (!claims.email || claims.email_verified !== true) {
    throw new InvalidTokenError("ERR_EMAIL_NOT_VERIFIED");
  }
  return { ...claims, email: claims.email.toLowerCase() };
}
