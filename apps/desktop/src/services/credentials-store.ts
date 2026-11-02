// A distributed OAuth client secret is public; PKCE and Google sign-in provide the security boundary.

declare const __GOOGLE_CLIENT_ID__: string;
declare const __GOOGLE_CLIENT_SECRET__: string;

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
}

export async function getCredentials(): Promise<GoogleCredentials> {
  const clientId = process.env.OTTER_MAIL_GOOGLE_CLIENT_ID?.trim() || __GOOGLE_CLIENT_ID__;
  const clientSecret =
    process.env.OTTER_MAIL_GOOGLE_CLIENT_SECRET?.trim() || __GOOGLE_CLIENT_SECRET__;
  if (!clientId || !clientSecret) {
    throw new Error(
      "This build has no Google OAuth client. Set OTTER_MAIL_GOOGLE_CLIENT_ID and OTTER_MAIL_GOOGLE_CLIENT_SECRET (see .env.example).",
    );
  }
  return { clientId, clientSecret };
}
