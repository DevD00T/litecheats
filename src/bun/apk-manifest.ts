import { inflateRawSync } from "node:zlib";

/**
 * Reads the identity of an Android APK straight from its AndroidManifest.xml, so
 * an upload's package name and versionCode come from the file itself rather than
 * from whatever someone typed into a form.
 *
 * An APK is a zip file and its manifest is compiled "binary XML" (AXML). This is a
 * small reader for exactly the parts needed here: the <manifest> element's
 * package / versionCode / versionName, and <uses-sdk>'s minSdkVersion.
 */
export interface ApkManifestInfo {
	packageName: string;
	versionCode: number;
	versionName: string;
	minSdkVersion: number | null;
}

export class ApkParseError extends Error {}

// ---------------------------------------------------------------------------
// Zip
// ---------------------------------------------------------------------------

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function readZipEntry(bytes: Uint8Array, wanted: string): Uint8Array {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

	// The end-of-central-directory record sits in the last 22 + 65535 bytes.
	let eocd = -1;
	for (
		let offset = bytes.length - 22;
		offset >= Math.max(0, bytes.length - 22 - 0xffff);
		offset--
	) {
		if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
			eocd = offset;
			break;
		}
	}
	if (eocd < 0) throw new ApkParseError("Not a valid APK: the zip directory is missing.");

	const entryCount = view.getUint16(eocd + 10, true);
	let cursor = view.getUint32(eocd + 16, true);
	const decoder = new TextDecoder();

	for (let index = 0; index < entryCount; index++) {
		if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) {
			throw new ApkParseError("Not a valid APK: corrupt zip directory.");
		}
		const method = view.getUint16(cursor + 10, true);
		const compressedSize = view.getUint32(cursor + 20, true);
		const nameLength = view.getUint16(cursor + 28, true);
		const extraLength = view.getUint16(cursor + 30, true);
		const commentLength = view.getUint16(cursor + 32, true);
		const localOffset = view.getUint32(cursor + 42, true);
		const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));

		if (name === wanted) {
			if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
				throw new ApkParseError("Not a valid APK: corrupt zip entry.");
			}
			const localNameLength = view.getUint16(localOffset + 26, true);
			const localExtraLength = view.getUint16(localOffset + 28, true);
			const start = localOffset + 30 + localNameLength + localExtraLength;
			const data = bytes.subarray(start, start + compressedSize);
			if (method === 0) return data;
			if (method === 8) return new Uint8Array(inflateRawSync(data));
			throw new ApkParseError(`Unsupported zip compression method ${method}.`);
		}

		cursor += 46 + nameLength + extraLength + commentLength;
	}

	throw new ApkParseError(`Not a valid APK: ${wanted} is missing.`);
}

// ---------------------------------------------------------------------------
// Binary XML
// ---------------------------------------------------------------------------

const CHUNK_STRING_POOL = 0x0001;
const CHUNK_XML = 0x0003;
const CHUNK_RESOURCE_MAP = 0x0180;
const CHUNK_START_ELEMENT = 0x0102;
const UTF8_FLAG = 0x100;
const NO_INDEX = 0xffffffff;

const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;

// android:* attribute resource ids, used when aapt2 leaves the attribute name empty.
const ATTR_VERSION_CODE = 0x0101021b;
const ATTR_VERSION_NAME = 0x0101021c;
const ATTR_MIN_SDK = 0x0101020c;

function readStringPool(view: DataView, bytes: Uint8Array, start: number): string[] {
	const headerSize = view.getUint16(start + 2, true);
	const count = view.getUint32(start + 8, true);
	const flags = view.getUint32(start + 16, true);
	const stringsStart = start + view.getUint32(start + 20, true);
	const utf8 = (flags & UTF8_FLAG) !== 0;
	const strings: string[] = [];

	for (let index = 0; index < count; index++) {
		let at = stringsStart + view.getUint32(start + headerSize + index * 4, true);
		if (utf8) {
			// Character count, then byte count; each is 1 or 2 bytes.
			at += (view.getUint8(at) & 0x80) !== 0 ? 2 : 1;
			let length = view.getUint8(at);
			if ((length & 0x80) !== 0) {
				length = ((length & 0x7f) << 8) | view.getUint8(at + 1);
				at += 2;
			} else {
				at += 1;
			}
			strings.push(new TextDecoder("utf-8").decode(bytes.subarray(at, at + length)));
		} else {
			let length = view.getUint16(at, true);
			if ((length & 0x8000) !== 0) {
				length = ((length & 0x7fff) << 16) | view.getUint16(at + 2, true);
				at += 4;
			} else {
				at += 2;
			}
			strings.push(new TextDecoder("utf-16le").decode(bytes.subarray(at, at + length * 2)));
		}
	}
	return strings;
}

function parseBinaryManifest(bytes: Uint8Array): ApkManifestInfo {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (bytes.length < 8 || view.getUint16(0, true) !== CHUNK_XML) {
		throw new ApkParseError("AndroidManifest.xml is not compiled binary XML.");
	}

	let strings: string[] = [];
	let resourceIds: number[] = [];
	let packageName: string | null = null;
	let versionCode: number | null = null;
	let versionName: string | null = null;
	let minSdkVersion: number | null = null;

	let cursor = view.getUint16(2, true);
	while (cursor + 8 <= bytes.length) {
		const type = view.getUint16(cursor, true);
		const headerSize = view.getUint16(cursor + 2, true);
		const size = view.getUint32(cursor + 4, true);
		if (size < 8) break;

		if (type === CHUNK_STRING_POOL) {
			strings = readStringPool(view, bytes, cursor);
		} else if (type === CHUNK_RESOURCE_MAP) {
			resourceIds = [];
			for (let at = cursor + 8; at < cursor + size; at += 4)
				resourceIds.push(view.getUint32(at, true));
		} else if (type === CHUNK_START_ELEMENT) {
			const ext = cursor + headerSize;
			const elementName = strings[view.getUint32(ext + 4, true)] ?? "";
			const attributeStart = view.getUint16(ext + 8, true);
			const attributeSize = view.getUint16(ext + 10, true);
			const attributeCount = view.getUint16(ext + 12, true);

			for (let index = 0; index < attributeCount; index++) {
				const at = ext + attributeStart + index * attributeSize;
				const nameIndex = view.getUint32(at + 4, true);
				const rawValue = view.getUint32(at + 8, true);
				const dataType = view.getUint8(at + 15);
				const data = view.getUint32(at + 16, true);
				const name = strings[nameIndex] ?? "";
				const resourceId = resourceIds[nameIndex];

				const asString = () =>
					rawValue !== NO_INDEX
						? (strings[rawValue] ?? null)
						: dataType === TYPE_STRING
							? (strings[data] ?? null)
							: null;
				const asInt = () =>
					dataType === TYPE_INT_DEC || dataType === TYPE_INT_HEX
						? data
						: Number.parseInt(asString() ?? "", 10) || null;

				if (elementName === "manifest") {
					if (name === "package") packageName = asString();
					if (name === "versionCode" || resourceId === ATTR_VERSION_CODE) versionCode = asInt();
					if (name === "versionName" || resourceId === ATTR_VERSION_NAME) versionName = asString();
				} else if (elementName === "uses-sdk") {
					if (name === "minSdkVersion" || resourceId === ATTR_MIN_SDK) minSdkVersion = asInt();
				}
			}

			if (elementName === "uses-sdk" || (elementName === "application" && packageName)) break;
		}

		cursor += size;
	}

	if (!packageName) throw new ApkParseError("The APK manifest has no package name.");
	if (!versionCode || versionCode < 1)
		throw new ApkParseError("The APK manifest has no versionCode.");

	return {
		packageName,
		versionCode,
		versionName: versionName ?? String(versionCode),
		minSdkVersion,
	};
}

export function readApkManifest(apk: Uint8Array): ApkManifestInfo {
	return parseBinaryManifest(readZipEntry(apk, "AndroidManifest.xml"));
}
