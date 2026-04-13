import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { checkExportAvailable, recordExport } from '@/lib/payments/usage-tracker';
import { uploadFile, getContentType } from '@/lib/storage/supabase-storage';
import { createGenerationHistory, hasGenerationHistoryFeature } from '@/lib/db/queries/generation-history';
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

export const runtime = 'nodejs';

function cleanText(input: string, maxLen = 4000) {
  const text = (input || '').replace(/\u0000/g, '').trim();
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}

function escapeXml(s: string) {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizeXmlText(s: string) {
  return (s || '').replace(
    /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD]/g,
    ''
  );
}

function buildNotesMasterXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notesMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Header Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="hdr" sz="quarter"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2971800" cy="458788"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/><a:lstStyle><a:lvl1pPr algn="l"><a:defRPr sz="1200"/></a:lvl1pPr></a:lstStyle><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Date Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="dt" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="3884613" y="0"/><a:ext cx="2971800" cy="458788"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/><a:lstStyle><a:lvl1pPr algn="r"><a:defRPr sz="1200"/></a:lvl1pPr></a:lstStyle><a:p><a:fld id="{5282F153-3F37-0F45-9E97-73ACFA13230C}" type="datetimeFigureOut"><a:rPr lang="en-US"/><a:t>7/23/19</a:t></a:fld><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="4" name="Slide Image Placeholder 3"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="1143000"/><a:ext cx="5486400" cy="3086100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="5" name="Notes Placeholder 4"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master text styles</a:t></a:r></a:p><a:p><a:pPr lvl="1"/><a:r><a:rPr lang="en-US"/><a:t>Second level</a:t></a:r></a:p><a:p><a:pPr lvl="2"/><a:r><a:rPr lang="en-US"/><a:t>Third level</a:t></a:r></a:p><a:p><a:pPr lvl="3"/><a:r><a:rPr lang="en-US"/><a:t>Fourth level</a:t></a:r></a:p><a:p><a:pPr lvl="4"/><a:r><a:rPr lang="en-US"/><a:t>Fifth level</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="6" name="Footer Placeholder 5"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="ftr" sz="quarter" idx="4"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="8685213"/><a:ext cx="2971800" cy="458787"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="b"/><a:lstStyle><a:lvl1pPr algn="l"><a:defRPr sz="1200"/></a:lvl1pPr></a:lstStyle><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="7" name="Slide Number Placeholder 6"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldNum" sz="quarter" idx="5"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="3884613" y="8685213"/><a:ext cx="2971800" cy="458787"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="b"/><a:lstStyle><a:lvl1pPr algn="r"><a:defRPr sz="1200"/></a:lvl1pPr></a:lstStyle><a:p><a:fld id="{CE5E9CC1-C706-0F49-92D6-E571CC5EEA8F}" type="slidenum"><a:rPr lang="en-US"/><a:t>‹#›</a:t></a:fld><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp></p:spTree><p:extLst><p:ext uri="{BB962C8B-B14F-4D97-AF65-F5344CB8AC3E}"><p14:creationId xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" val="1024086991"/></p:ext></p:extLst></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:notesStyle><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr><a:lvl2pPr marL="457200" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl2pPr><a:lvl3pPr marL="914400" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl3pPr><a:lvl4pPr marL="1371600" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl4pPr><a:lvl5pPr marL="1828800" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl5pPr><a:lvl6pPr marL="2286000" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl6pPr><a:lvl7pPr marL="2743200" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl7pPr><a:lvl8pPr marL="3200400" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl8pPr><a:lvl9pPr marL="3657600" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl9pPr></p:notesStyle></p:notesMaster>`;
}

function buildNotesMasterRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;
}

function buildNotesSlideXml(noteText: string, slideNumber: number) {
  const t = escapeXml(sanitizeXmlText(noteText || ''));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" dirty="0"><a:latin typeface="Arial"/><a:ea typeface="Arial"/><a:cs typeface="Arial"/></a:rPr><a:t>${t}</a:t></a:r><a:endParaRPr lang="en-US" dirty="0"/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="4" name="Slide Number Placeholder 3"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldNum" sz="quarter" idx="10"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:fld id="{F7021451-1387-4CA6-816F-3879F97B5CBC}" type="slidenum"><a:rPr lang="en-US"/><a:t>${slideNumber}</a:t></a:fld><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp></p:spTree><p:extLst><p:ext uri="{BB962C8B-B14F-4D97-AF65-F5344CB8AC3E}"><p14:creationId xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" val="1024086991"/></p:ext></p:extLst></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
}

function buildNotesSlideRels(slideNum: number) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="../notesMasters/notesMaster1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide${slideNum}.xml"/>
</Relationships>`;
}

function ensureRelationship(xml: string, params: { type: string; target: string }) {
  const { type, target } = params;
  const relTypeRe = new RegExp(`Type="${type.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}"`, 'i');
  const has = relTypeRe.test(xml);
  if (has) {
    return xml.replace(
      new RegExp(`(<Relationship[^>]+Type="${type.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}"[^>]+Target=")[^"]+(")`, 'i'),
      `$1${target}$2`
    );
  }
  let maxId = 0;
  (xml.match(/Id="rId(\d+)"/g) || []).forEach((m) => {
    const n = Number(m.match(/rId(\d+)/)?.[1] || 0);
    if (n > maxId) maxId = n;
  });
  const nextId = maxId + 1;
  const insert = `<Relationship Id="rId${nextId}" Type="${type}" Target="${target}"/>`;
  return xml.replace(/<\/Relationships>/i, `${insert}</Relationships>`);
}

function ensureContentType(ctXml: string, partName: string, contentType: string) {
  if (ctXml.includes(partName)) return ctXml;
  const entry = `<Override PartName="${partName}" ContentType="${contentType}"/>`;
  return ctXml.replace(/<\/Types>/i, `${entry}</Types>`);
}

function ensurePresentationNotesMaster(presXml: string, presRelsXml: string) {
  const hasNotesMasterRel = /relationships\/notesMaster/i.test(presRelsXml);
  let nextRid = 1;
  (presRelsXml.match(/Id="rId(\d+)"/g) || []).forEach((m) => {
    const n = Number(m.match(/rId(\d+)/)?.[1] || 0);
    if (n >= nextRid) nextRid = n + 1;
  });
  let relId = '';
  let relsOut = presRelsXml;
  if (!hasNotesMasterRel) {
    relId = `rId${nextRid++}`;
    const rel = `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="notesMasters/notesMaster1.xml"/>`;
    relsOut = presRelsXml.replace(/<\/Relationships>/i, `${rel}</Relationships>`);
  } else {
    const m = presRelsXml.match(/Id="(rId\d+)"[^>]+Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/notesMaster"/i);
    relId = m?.[1] || 'rId999';
  }
  let presOut = presXml;
  if (!/notesMasterIdLst/i.test(presOut)) {
    presOut = presOut.replace(
      /<\/p:sldIdLst>/i,
      `</p:sldIdLst><p:notesMasterIdLst><p:notesMasterId r:id="${relId}"/></p:notesMasterIdLst>`
    );
  }
  if (!/notesSz/i.test(presOut)) {
    presOut = presOut.replace(
      /<\/p:sldSz>/i,
      `</p:sldSz><p:notesSz cx="5143500" cy="9144000"/>`
    );
  }
  return { presXml: presOut, presRelsXml: relsOut };
}

interface Pdf2SlidesResult {
  success: boolean;
  message?: string;
  pptx_base64?: string;
}

async function convertPdfWithPython(pdfBase64: string, notes: Array<{slide_number: number; note_text: string}>): Promise<Pdf2SlidesResult> {
  return new Promise((resolve) => {
    try {
      // Create temp input JSON file
      const tmpDir = os.tmpdir();
      const inputPath = path.join(tmpDir, `pdf2pptx_input_${Date.now()}.json`);
      const inputData = {
        pdf_base64: pdfBase64,
        notes: notes,
      };
      
      fs.writeFileSync(inputPath, JSON.stringify(inputData), 'utf-8');
      
      // Path to Python script
      const scriptPath = path.join(process.cwd(), 'scripts', 'pdf2pptx.py');
      
      // Spawn Python process
      const pythonProcess = spawn('python', [scriptPath, inputPath], {
        timeout: 120000, // 2 minutes timeout
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      
      let stdout = '';
      let stderr = '';
      
      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      pythonProcess.on('close', (code) => {
        // Clean up input file
        try {
          if (fs.existsSync(inputPath)) {
            fs.unlinkSync(inputPath);
          }
        } catch (e) {
          // Ignore cleanup errors
        }
        
        if (code !== 0) {
          console.error(`Python script exited with code ${code}:`, stderr);
          resolve({ success: false, message: `Python script failed: ${stderr || 'Unknown error'}` });
          return;
        }
        
        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch (e) {
          console.error('Failed to parse Python output:', stdout, stderr);
          resolve({ success: false, message: `Invalid Python output: ${stdout}` });
        }
      });
      
      pythonProcess.on('error', (err) => {
        console.error('Failed to spawn Python process:', err);
        resolve({ success: false, message: `Failed to run Python: ${err.message}` });
      });
      
    } catch (error: any) {
      console.error('convertPdfWithPython error:', error);
      resolve({ success: false, message: error?.message || 'Unknown error' });
    }
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const exportCheck = await checkExportAvailable(session.user.id);
  if (!exportCheck.available) {
    return NextResponse.json(
      {
        error: 'Export limit reached',
        remaining: exportCheck.remaining,
        limit: exportCheck.limit,
      },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const filename = (body?.filename || 'lecture-rehearsal.pdf.pptx').toString();
    const slides = Array.isArray(body?.slides) ? body.slides : [];
    const pdfBase64 = (body?.pdfBase64 || '').toString();
    if (slides.length === 0) {
      return NextResponse.json({ error: 'slides is required' }, { status: 400 });
    }

    const sortedSlides = [...slides].sort((a, b) => (Number(a?.slide_number) || 0) - (Number(b?.slide_number) || 0));
    
    // Prepare notes data for Python script
    const notesData = sortedSlides
      .filter((s) => s?.note_text)
      .map((s) => ({
        slide_number: Number(s.slide_number) || 0,
        note_text: cleanText(s.note_text || '', 8000),
      }));
    
    // Try Python pdf2slides first (most reliable)
    if (pdfBase64) {
      console.log('[Export PDF->PPTX] Attempting Python pdf2slides conversion...');
      const pythonResult = await convertPdfWithPython(pdfBase64, notesData);
      
      if (pythonResult.success && pythonResult.pptx_base64) {
        console.log('[Export PDF->PPTX] Python conversion successful');
        const buffer = Buffer.from(pythonResult.pptx_base64, 'base64');
        
        await recordExport(session.user.id);
        
        try {
          const hasPremium = await hasGenerationHistoryFeature(session.user.id);
          console.log('[Export PDF->PPTX] hasPremium:', hasPremium);
          if (hasPremium) {
            console.log('[Export PDF->PPTX] Uploading file...', { filename, bufferSize: buffer.length });
            const uploadResult = await uploadFile(
              session.user.id,
              filename,
              buffer,
              getContentType('pptx')
            );
            console.log('[Export PDF->PPTX] Upload result:', { success: uploadResult.success, fileUrl: uploadResult.fileUrl, error: uploadResult.error });
            if (uploadResult.success && uploadResult.fileUrl) {
              const historyResult = await createGenerationHistory({
                userId: session.user.id,
                module: 'lecture_rehearsal',
                title: filename,
                format: 'pptx',
                fileUrl: uploadResult.fileUrl,
                fileSize: buffer.length,
                metadata: { source: 'pdf_to_pptx', slideCount: sortedSlides.length },
              });
              console.log('[Export PDF->PPTX] Generation history saved successfully:', historyResult.created.id);
            } else {
              console.error('[Export PDF->PPTX] Upload failed:', uploadResult.error);
            }
          } else {
            console.log('[Export PDF->PPTX] User does not have premium, skipping history');
          }
        } catch (historyError) {
          console.error('[Export PDF->PPTX] Failed to save generation history:', historyError);
        }
        
        return new NextResponse(buffer, {
          headers: {
            'Content-Type': getContentType('pptx'),
            'Content-Disposition': `attachment; filename="${filename}"`,
          },
        });
      } else {
        console.warn('[Export PDF->PPTX] Python conversion failed, falling back to PptxGenJS:', pythonResult.message);
      }
    }
    
    // Fallback: Use PptxGenJS without PDF images (just titles)
    console.log('[Export PDF->PPTX] Using fallback PptxGenJS conversion...');
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.author = 'AI Teaching Assistant';
    pptx.title = filename.replace(/\.pptx$/i, '');

    for (const s of sortedSlides) {
      const slide = pptx.addSlide();
      const title = cleanText(s?.slide_title || `Page ${s?.slide_number || ''}`, 200);

      // Add title text (fallback mode without PDF images)
      slide.addText(title, {
        x: 0.6, y: 0.4, w: 12.0, h: 0.6,
        fontSize: 28, bold: true, color: '1f2937', fontFace: 'Arial',
      });

      // Notes will be added via XML modification after PPTX generation
    }

    const rawBuffer = await pptx.write({ outputType: 'nodebuffer' } as any);
    let buffer = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer as Uint8Array);
    
    // Add notes by modifying PPTX XML (similar to export-pptx-notes)
    // Always try to add notes, even if PDF rendering failed
    const slidesWithNotes = sortedSlides.filter((s) => {
      const noteText = cleanText(s?.note_text || '', 8000);
      return noteText.length > 0;
    });
    
    if (slidesWithNotes.length > 0) {
      console.log(`[Export PDF->PPTX] Adding notes to ${slidesWithNotes.length} slides`);
      try {
        const zip = await JSZip.loadAsync(buffer);
        
        // Ensure notes master exists
        const hasNotesMaster = !!zip.file('ppt/notesMasters/notesMaster1.xml');
        if (!hasNotesMaster) {
          zip.file('ppt/notesMasters/notesMaster1.xml', buildNotesMasterXml());
          zip.file('ppt/notesMasters/_rels/notesMaster1.xml.rels', buildNotesMasterRels());
        }
        
        // Ensure presentation references notes master
        const presPath = 'ppt/presentation.xml';
        const presRelsPath = 'ppt/_rels/presentation.xml.rels';
        if (zip.file(presPath) && zip.file(presRelsPath)) {
          const presXml = await zip.file(presPath)!.async('string');
          const presRelsXml = await zip.file(presRelsPath)!.async('string');
          const updated = ensurePresentationNotesMaster(presXml, presRelsXml);
          zip.file(presPath, updated.presXml);
          zip.file(presRelsPath, updated.presRelsXml);
        }
        
        // Update content types
        const ctPath = '[Content_Types].xml';
        if (zip.file(ctPath)) {
          let ctXml = await zip.file(ctPath)!.async('string');
          ctXml = ensureContentType(
            ctXml,
            '/ppt/notesMasters/notesMaster1.xml',
            'application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml'
          );
          for (const s of sortedSlides) {
            const slide_number = Number(s?.slide_number) || 0;
            if (!slide_number) continue;
            ctXml = ensureContentType(
              ctXml,
              `/ppt/notesSlides/notesSlide${slide_number}.xml`,
              'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml'
            );
          }
          zip.file(ctPath, ctXml);
        }
        
        // Write notes slides + wire relationships
        for (const s of sortedSlides) {
          const slide_number = Number(s?.slide_number) || 0;
          if (!slide_number) continue;
          const noteText = cleanText(s?.note_text || '', 8000);
          if (!noteText) continue;
          
          const slidePath = `ppt/slides/slide${slide_number}.xml`;
          const slideRelsPath = `ppt/slides/_rels/slide${slide_number}.xml.rels`;
          if (!zip.file(slidePath) || !zip.file(slideRelsPath)) {
            console.warn(`[Export PDF->PPTX] Slide ${slide_number} files not found, skipping notes`);
            continue;
          }
          
          const notesPath = `ppt/notesSlides/notesSlide${slide_number}.xml`;
          const notesRelsPath = `ppt/notesSlides/_rels/notesSlide${slide_number}.xml.rels`;
          
          zip.file(notesPath, buildNotesSlideXml(noteText, slide_number));
          zip.file(notesRelsPath, buildNotesSlideRels(slide_number));
          
          const relXml = await zip.file(slideRelsPath)!.async('string');
          const updatedRels = ensureRelationship(relXml, {
            type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide',
            target: `../notesSlides/notesSlide${slide_number}.xml`,
          });
          zip.file(slideRelsPath, updatedRels);
        }
        
        const outBuf = await zip.generateAsync({ type: 'nodebuffer' });
        buffer = Buffer.from(outBuf);
        console.log(`[Export PDF->PPTX] Successfully added notes to PPTX`);
      } catch (notesError: any) {
        console.error('[Export PDF->PPTX] Failed to add notes:', notesError);
        // Continue without notes rather than failing completely
      }
    } else {
      console.log('[Export PDF->PPTX] No notes to add');
    }

    await recordExport(session.user.id);

    try {
      const hasPremium = await hasGenerationHistoryFeature(session.user.id);
      console.log('[Export PDF->PPTX] (fallback) hasPremium:', hasPremium);
      if (hasPremium) {
        console.log('[Export PDF->PPTX] (fallback) Uploading file...', { filename, bufferSize: buffer.length });
        const uploadResult = await uploadFile(
          session.user.id,
          filename,
          buffer,
          getContentType('pptx')
        );
        console.log('[Export PDF->PPTX] (fallback) Upload result:', { success: uploadResult.success, fileUrl: uploadResult.fileUrl, error: uploadResult.error });
        if (uploadResult.success && uploadResult.fileUrl) {
          const historyResult = await createGenerationHistory({
            userId: session.user.id,
            module: 'lecture_rehearsal',
            title: filename,
            format: 'pptx',
            fileUrl: uploadResult.fileUrl,
            fileSize: buffer.length,
            metadata: { source: 'pdf_to_pptx_fallback', slideCount: sortedSlides.length },
          });
          console.log('[Export PDF->PPTX] Generation history saved successfully (fallback):', historyResult.created.id);
        } else {
          console.error('[Export PDF->PPTX] (fallback) Upload failed:', uploadResult.error);
        }
      } else {
        console.log('[Export PDF->PPTX] (fallback) User does not have premium, skipping history');
      }
    } catch (historyError) {
      console.error('[Export PDF->PPTX] Failed to save generation history:', historyError);
    }

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': getContentType('pptx'),
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (e: any) {
    console.error('Export PDF to PPTX error:', e);
    return NextResponse.json({ error: e?.message || 'Failed to export PDF to PPTX' }, { status: 500 });
  }
}
