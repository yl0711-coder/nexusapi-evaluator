// Ports in this list are treated as user-owned infrastructure. The launcher must
// never bind to them, even if they look available during a quick local check.
const DEFAULT_PROTECTED_PORTS = [17891];

export function readProtectedPorts(configuredValue, envValue = process.env.PROTECTED_PORTS) {
  const configuredPorts = Array.isArray(configuredValue) ? configuredValue : [];
  const envPorts = String(envValue || "")
    .split(",")
    .filter(Boolean);
  const ports = [...DEFAULT_PROTECTED_PORTS, ...configuredPorts, ...envPorts]
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0 && value < 65536);

  return new Set(ports);
}

export function isProtectedPort(port, protectedPorts) {
  return protectedPorts.has(Number(port));
}
