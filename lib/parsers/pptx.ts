import JSZip from 'jszip';

function decodeXmlEntities(input: string) {
    return input
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        // numeric entities
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function extractTextFromSlideXml(xml: string) {
    // PowerPoint slide text commonly lives in <a:t> ... </a:t>
    const texts: string[] = [];
    const re = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
        const raw = m[1] ?? '';
        const decoded = decodeXmlEntities(raw).trim();
        if (decoded) texts.push(decoded);
    }

    return texts;
}

function countMatches(xml: string, re: RegExp) {
    const m = xml.match(re);
    return m ? m.length : 0;
}

function detectSlideFeatures(xml: string) {
    // Heuristic counts for richer lecture scripts
    const imageCount = countMatches(xml, /<p:pic\b/gi) + countMatches(xml, /<a:blip\b/gi);
    const tableCount = countMatches(xml, /<a:tbl\b/gi);
    const chartHintCount = countMatches(xml, /<c:chart\b/gi) + countMatches(xml, /<c:plotArea\b/gi);
    const equationHintCount =
        countMatches(xml, /<m:oMath\b/gi) +
        countMatches(xml, /<m:oMathPara\b/gi) +
        countMatches(xml, /<a:math\b/gi);
    const hasSmartArt = /<dgm:relIds\b/i.test(xml) || /relationships\/diagram/i.test(xml);
    return { imageCount, tableCount, chartHintCount, equationHintCount, hasSmartArt };
}

export async function extractSlidesFromPptx(buffer: Buffer) {
    const zip = await JSZip.loadAsync(buffer);
    const slideFiles = Object.keys(zip.files)
        .filter((p) => /^ppt\/slides\/slide\d+\.xml$/i.test(p))
        .sort((a, b) => {
            const an = Number((a.match(/slide(\d+)\.xml/i)?.[1]) || 0);
            const bn = Number((b.match(/slide(\d+)\.xml/i)?.[1]) || 0);
            return an - bn;
        });

    const slides: Array<{
        slideNum: number;
        text: string;
        textLen: number;
        features: { imageCount: number; tableCount: number; chartHintCount: number; equationHintCount: number; hasSmartArt: boolean; chartRelCount: number };
    }> = [];
    for (const path of slideFiles) {
        const slideNum = Number((path.match(/slide(\d+)\.xml/i)?.[1]) || 0);
        const xml = await zip.file(path)!.async('string');
        const texts = extractTextFromSlideXml(xml);
        const f = detectSlideFeatures(xml);
        const relPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;
        let chartRelCount = 0;
        if (zip.file(relPath)) {
            const relXml = await zip.file(relPath)!.async('string');
            chartRelCount = countMatches(relXml, /relationships\/chart/i);
        }
        const text = texts.join('\n');
        slides.push({ slideNum, text, textLen: text.trim().length, features: { ...f, chartRelCount } });
    }
    return slides;
}

export async function extractTextFromPptx(buffer: Buffer) {
    const zip = await JSZip.loadAsync(buffer);
    const slideFiles = Object.keys(zip.files)
        .filter((p) => /^ppt\/slides\/slide\d+\.xml$/i.test(p))
        .sort((a, b) => {
            const an = Number((a.match(/slide(\d+)\.xml/i)?.[1]) || 0);
            const bn = Number((b.match(/slide(\d+)\.xml/i)?.[1]) || 0);
            return an - bn;
        });

    if (slideFiles.length === 0) {
        return '';
    }

    const parts: string[] = [];
    for (const path of slideFiles) {
        const slideNum = Number((path.match(/slide(\d+)\.xml/i)?.[1]) || 0);
        const xml = await zip.file(path)!.async('string');
        const texts = extractTextFromSlideXml(xml);
        if (texts.length > 0) {
            // Use [PAGE: X] format for consistency with PDF parsing
            parts.push(`[PAGE: ${slideNum}]\n${texts.join('\n')}`);
        }
    }

    return parts.join('\n\n');
}


