/**
 * @format 1.0.0 | v1.0.0 | v1.0.0-beta
 * @suffix `alpha` < `beta` < `rc` < `release` = ""
 */
const compareVersion = (v1: string, v2: string): number => {
  const parseVersion = (version: string) => {
    const [main, suffix] = version.split("-");
    const [major, minor, patch] = main.split(".").map(Number);
    return { major, minor, patch, suffix: suffix || "" };
  };

  const suffixOrder = ["alpha", "beta", "rc", "release", ""];

  const v1Parsed = parseVersion(v1);
  const v2Parsed = parseVersion(v2);

  if (v1Parsed.major !== v2Parsed.major) {
    return v1Parsed.major - v2Parsed.major;
  }
  if (v1Parsed.minor !== v2Parsed.minor) {
    return v1Parsed.minor - v2Parsed.minor;
  }
  if (v1Parsed.patch !== v2Parsed.patch) {
    return v1Parsed.patch - v2Parsed.patch;
  }

  const v1SuffixIndex = suffixOrder.indexOf(v1Parsed.suffix);
  const v2SuffixIndex = suffixOrder.indexOf(v2Parsed.suffix);

  return v1SuffixIndex - v2SuffixIndex;
};

export default compareVersion;