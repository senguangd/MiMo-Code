declare global {
  const ADPCLI_VERSION: string
  const ADPCLI_CHANNEL: string
}

export const InstallationVersion = typeof ADPCLI_VERSION === "string" ? ADPCLI_VERSION : "local"
export const InstallationChannel = typeof ADPCLI_CHANNEL === "string" ? ADPCLI_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
