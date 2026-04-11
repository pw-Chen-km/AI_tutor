// Client-side file reading utilities

export async function readTextFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = reject;
        reader.readAsText(file);
    });
}

export async function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const result = e.target?.result as string;
            // Remove data URL prefix to get pure base64
            const base64 = result.split(',')[1] || result;
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

export async function parseFile(file: File): Promise<string> {
    const fileType = file.name.split('.').pop()?.toLowerCase();

    switch (fileType) {
        case 'txt':
        case 'md':
            return await readTextFile(file);

        case 'pdf':
        case 'docx':
        case 'pptx':
        case 'xlsx':
            // These require server-side processing
            return await uploadAndParse(file);

        default:
            throw new Error(`Unsupported file type: ${fileType}`);
    }
}

// Enhanced file parser for Exam Evaluation (supports images, ZIP, etc.)
export async function parseFileForEvaluation(file: File): Promise<string> {
    const fileType = file.name.split('.').pop()?.toLowerCase();

    switch (fileType) {
        case 'txt':
        case 'md':
            return await readTextFile(file);

        case 'pdf':
        case 'docx':
        case 'pptx':
        case 'xlsx':
            // These require server-side processing
            return await uploadAndParse(file);

        case 'png':
        case 'jpg':
        case 'jpeg':
        case 'gif':
        case 'webp':
            // For images, we return a placeholder and store base64 separately
            // The actual image will be sent to LLM via vision API
            return `[IMAGE: ${file.name}]`;

        case 'zip':
        case 'rar':
            // ZIP/RAR files will be handled by extract-archive API
            // Return placeholder - actual extraction happens in handleStudentFileUpload
            return `[ARCHIVE: ${file.name}]`;

        default:
            // Try to read as text for unknown types
            try {
                return await readTextFile(file);
            } catch {
                return `[BINARY FILE: ${file.name}]`;
            }
    }
}

async function uploadAndParse(file: File): Promise<string> {
    const formData = new FormData();
    formData.append('file', file);

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout

        const response = await fetch('/api/parse-file', {
            method: 'POST',
            body: formData,
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Failed to parse file (status: ${response.status})`);
        }

        const data = await response.json();
        return data.content;
    } catch (error: any) {
        if (error.name === 'AbortError') {
            throw new Error('File upload timed out. Please try a smaller file.');
        }
        throw new Error(`Failed to upload file: ${error.message}`);
    }
}
