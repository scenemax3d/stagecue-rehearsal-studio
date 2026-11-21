export const installed = location.port === "21870";
export const localGateway = "ws://127.0.0.1:" + (installed ? 21872 : 21972);
export const localAsr = "ws://127.0.0.1:" + (installed ? 21871 : 8765);
// Built-in loopback connections follow the studio when a script moves between the development and installed editions.
export function resolveGateway(url: string) {
  return /^ws:\/\/127\.0\.0\.1:(21872|21972)\/?$/.test(url)
    ? localGateway
    : url;
}
