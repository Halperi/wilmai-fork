/** Compatibility exports for the existing iOS regression suite. Runtime code uses secure-vault. */
export { SecureVault as IosVault, secureVault as iosVault, secureInstallation as iosInstallation,
  INSTALLATION_KEY as IOS_INSTALLATION_KEY, usesSecureVault as usesIosVault, emptyVault, emptyCredentials } from "./secure-vault";
export type { Credentials, VaultData } from "./secure-vault";
