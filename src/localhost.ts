export const installed = globalThis.location?.port === "21870";
export const localGateway = "ws://127.0.0.1:" + (installed ? 21872 : 21972);
export const localAsr = "ws://127.0.0.1:" + (installed ? 21871 : 8765);
