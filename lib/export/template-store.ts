import { del, get, set } from 'idb-keyval';

const KEY_PREFIX = 'ai-teaching-assistant:export-template:';

export type TemplateType = 'docx' | 'pptx';

export interface StoredTemplate {
    id: string;
    name: string;
    type: TemplateType;
    data: ArrayBuffer; // raw file bytes
    savedAt: number;
}

function key(id: string) {
    return `${KEY_PREFIX}${id}`;
}

/**
 * Saves a template buffer to IndexedDB.
 */
export async function saveTemplateToIdb(id: string, data: ArrayBuffer): Promise<void> {
    await set(key(id), data);
}

/**
 * Retrieves a template buffer from IndexedDB.
 */
export async function getTemplateFromIdb(id: string): Promise<ArrayBuffer | undefined> {
    const v = await get(key(id));
    return v as ArrayBuffer | undefined;
}

/**
 * Deletes a template from IndexedDB.
 */
export async function deleteTemplateFromIdb(id: string): Promise<void> {
    await del(key(id));
}
