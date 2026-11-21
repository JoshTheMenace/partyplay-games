/** The sandbox never saves: the journal's packer is only measured, so "packing" may be the identity. */
export const deflateRawSync = (bytes: Uint8Array) => bytes;
export const inflateRawSync = (bytes: Uint8Array) => bytes;
