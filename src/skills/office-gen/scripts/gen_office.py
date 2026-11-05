#!/usr/bin/env python3
"""office-gen：用纯 Python 标准库生成真正的 OOXML 文件（pptx / docx / xlsx）。

用法：
    python3 gen_office.py pptx <output.pptx> <spec.json>
    python3 gen_office.py docx <output.docx> <spec.json>
    python3 gen_office.py xlsx <output.xlsx> <spec.json>

spec 格式见 SKILL.md。生成的是标准 zip 容器（OOXML），可直接被
PowerPoint / Keynote / Word / Excel / WPS 打开。
"""

from __future__ import annotations

import json
import sys
import zipfile
from datetime import datetime, timezone
from xml.sax.saxutils import escape

XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main"
NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main"
NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS_X = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"

REL_OFFICE = NS_R + "/officeDocument"
REL_CORE = "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties"
REL_EXT = NS_R + "/extended-properties"

CT_RELS = "application/vnd.openxmlformats-package.relationships+xml"
CT_XML = "application/xml"


def esc(text: object) -> str:
    return escape(str(text))


def fail(message: str) -> None:
    print(f"office-gen: {message}", file=sys.stderr)
    sys.exit(1)


def write_zip(path: str, entries: list[tuple[str, str]]) -> None:
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as bundle:
        for name, data in entries:
            bundle.writestr(name, data)


def content_types(overrides: list[tuple[str, str]]) -> str:
    body = "".join(
        f'<Override PartName="{part}" ContentType="{ctype}"/>'
        for part, ctype in overrides
    )
    return (
        XML_DECL
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + f'<Default Extension="rels" ContentType="{CT_RELS}"/>'
        + f'<Default Extension="xml" ContentType="{CT_XML}"/>'
        + body
        + "</Types>"
    )


def rels(pairs: list[tuple[str, str, str]]) -> str:
    body = "".join(
        f'<Relationship Id="{rid}" Type="{rtype}" Target="{target}"/>'
        for rid, rtype, target in pairs
    )
    return (
        XML_DECL
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + body
        + "</Relationships>"
    )


def doc_props(title: str) -> list[tuple[str, str]]:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    core = (
        XML_DECL
        + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"'
        + ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"'
        + ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        + f"<dc:title>{esc(title)}</dc:title><dc:creator>office-gen</dc:creator><cp:lastModifiedBy>office-gen</cp:lastModifiedBy>"
        + f"<dcterms:created xsi:type=\"dcterms:W3CDTF\">{now}</dcterms:created>"
        + f"<dcterms:modified xsi:type=\"dcterms:W3CDTF\">{now}</dcterms:modified>"
        + "</cp:coreProperties>"
    )
    app = (
        XML_DECL
        + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
        + "<Application>office-gen</Application></Properties>"
    )
    return [("docProps/core.xml", core), ("docProps/app.xml", app)]


def root_rels(document_part: str) -> str:
    return rels(
        [
            ("rId1", REL_OFFICE, document_part),
            ("rId2", REL_CORE, "docProps/core.xml"),
            ("rId3", REL_EXT, "docProps/app.xml"),
        ]
    )


# ─── PPTX ────────────────────────────────────────────────────

SLIDE_W = 12192000
SLIDE_H = 6858000
MASTER_RID = "rId1"
THEME_XML = (
    XML_DECL
    + f'<a:theme xmlns:a="{NS_A}" name="office-gen"><a:themeElements>'
    + '<a:clrScheme name="office-gen"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>'
    + '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="262626"/></a:dk2>'
    + '<a:lt2><a:srgbClr val="F4F4F5"/></a:lt2><a:accent1><a:srgbClr val="4F6BED"/></a:accent1>'
    + '<a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>'
    + '<a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>'
    + '<a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink>'
    + '<a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>'
    + '<a:fontScheme name="office-gen"><a:majorFont><a:latin typeface="PingFang SC"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>'
    + '<a:minorFont><a:latin typeface="PingFang SC"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
    + "<a:fmtScheme name=\"office-gen\">"
    + '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>'
    + '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>'
    + '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
    + '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>'
    + "</a:fmtScheme></a:themeElements></a:theme>"
)

SP_TREE_HEAD = (
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>'
)


def pptx_para(text: str, size: int, bold: bool, bullet: bool, color: str) -> str:
    props = f'sz="{size}"' + (' b="1"' if bold else "")
    fill = f'<a:solidFill><a:schemeClr val="{color}"/></a:solidFill>'
    p_pr = (
        '<a:pPr marL="285750" indent="-285750"><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr>'
        if bullet
        else "<a:pPr/>"
    )
    return (
        f"<a:p>{p_pr}<a:r><a:rPr {props} dirty=\"0\">{fill}</a:rPr>"
        + f"<a:t>{esc(text)}</a:t></a:r></a:p>"
    )


def pptx_textbox(sp_id: int, x: int, y: int, cx: int, cy: int, paras: str) -> str:
    return (
        f'<p:sp><p:nvSpPr><p:cNvPr id="{sp_id}" name="TextBox {sp_id}"/>'
        + '<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
        + f"<p:spPr><a:xfrm><a:off x=\"{x}\" y=\"{y}\"/><a:ext cx=\"{cx}\" cy=\"{cy}\"/></a:xfrm>"
        + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>'
        + f'<p:txBody><a:bodyPr wrap="square" rtlCol="0"/><a:lstStyle/>{paras}</p:txBody></p:sp>'
    )


def build_pptx(spec: dict) -> list[tuple[str, str]]:
    slides = spec.get("slides")
    if not isinstance(slides, list) or not slides:
        fail("pptx spec 需要 slides 数组（至少一页）")
    title = spec.get("title") or slides[0].get("title") or "Presentation"

    entries: list[tuple[str, str]] = []
    overrides: list[tuple[str, str]] = [
        ("/ppt/presentation.xml", "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"),
        ("/ppt/slideMasters/slideMaster1.xml", "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"),
        ("/ppt/slideLayouts/slideLayout1.xml", "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"),
        ("/ppt/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml"),
    ]
    slide_ids: list[tuple[int, str]] = []
    for index in range(len(slides)):
        part = f"/ppt/slides/slide{index + 1}.xml"
        overrides.append(
            (part, "application/vnd.openxmlformats-officedocument.presentationml.slide+xml")
        )
        slide_ids.append((256 + index, f"rId{index + 2}"))

    entries.append(("[Content_Types].xml", content_types(overrides)))
    entries.append(("_rels/.rels", root_rels("ppt/presentation.xml")))
    entries.extend(doc_props(title))

    sld_ids = "".join(
        f'<p:sldId id="{sid}" r:id="{rid}"/>' for sid, rid in slide_ids
    )
    entries.append(
        (
            "ppt/presentation.xml",
            XML_DECL
            + f'<p:presentation xmlns:a="{NS_A}" xmlns:r="{NS_R}" xmlns:p="{NS_P}">'
            + f'<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="{MASTER_RID}"/></p:sldMasterIdLst>'
            + f"<p:sldIdLst>{sld_ids}</p:sldIdLst>"
            + f'<p:sldSz cx="{SLIDE_W}" cy="{SLIDE_H}"/><p:notesSz cx="6858000" cy="9144000"/>'
            + "</p:presentation>",
        )
    )
    pres_rels = [
        (MASTER_RID, NS_R + "/slideMaster", "slideMasters/slideMaster1.xml")
    ] + [
        (rid, NS_R + "/slide", f"slides/slide{i + 1}.xml")
        for i, (_, rid) in enumerate(slide_ids)
    ] + [
        (f"rId{len(slide_ids) + 2}", NS_R + "/theme", "theme/theme1.xml")
    ]
    entries.append(("ppt/_rels/presentation.xml.rels", rels(pres_rels)))

    master_rels = rels(
        [
            ("rId1", NS_R + "/slideLayout", "../slideLayouts/slideLayout1.xml"),
            ("rId2", NS_R + "/theme", "../theme/theme1.xml"),
        ]
    )
    entries.append(("ppt/slideMasters/slideMaster1.xml", XML_DECL + (
        f'<p:sldMaster xmlns:a="{NS_A}" xmlns:r="{NS_R}" xmlns:p="{NS_P}">'
        + '<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="lt1"/></p:bgRef></p:bg>'
        + f"<p:spTree>{SP_TREE_HEAD}</p:spTree></p:cSld>"
        + '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2"'
        + ' accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
        + '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>'
    )))
    entries.append(("ppt/slideMasters/_rels/slideMaster1.xml.rels", master_rels))

    layout = XML_DECL + (
        f'<p:sldLayout xmlns:a="{NS_A}" xmlns:r="{NS_R}" xmlns:p="{NS_P}" type="blank">'
        + '<p:cSld name="Blank">'
        + f"<p:spTree>{SP_TREE_HEAD}</p:spTree></p:cSld>"
        + "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>"
    )
    entries.append(("ppt/slideLayouts/slideLayout1.xml", layout))
    entries.append(
        (
            "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
            rels([("rId1", NS_R + "/slideMaster", "../slideMasters/slideMaster1.xml")]),
        )
    )
    entries.append(("ppt/theme/theme1.xml", THEME_XML))

    for index, slide in enumerate(slides):
        if not isinstance(slide, dict) or not slide.get("title"):
            fail(f"第 {index + 1} 页缺少 title")
        heading = pptx_para(slide["title"], 4000, True, False, "tx1")
        title_box = pptx_textbox(
            2, 838200, 457200, SLIDE_W - 1676400, 1280160, heading
        )
        bullets = slide.get("bullets") or []
        if not isinstance(bullets, list):
            fail(f"第 {index + 1} 页的 bullets 必须是数组")
        body = "".join(
            pptx_para(str(item), 2000, False, True, "tx1") for item in bullets
        )
        body_box = pptx_textbox(
            3,
            1143000,
            2190750,
            SLIDE_W - 2286000,
            SLIDE_H - 2762250,
            body or "<a:p/>",
        )
        slide_xml = XML_DECL + (
            f'<p:sld xmlns:a="{NS_A}" xmlns:r="{NS_R}" xmlns:p="{NS_P}">'
            + f"<p:cSld><p:spTree>{SP_TREE_HEAD}{title_box}{body_box}</p:spTree></p:cSld>"
            + "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"
        )
        entries.append((f"ppt/slides/slide{index + 1}.xml", slide_xml))
        entries.append(
            (
                f"ppt/slides/_rels/slide{index + 1}.xml.rels",
                rels([("rId1", NS_R + "/slideLayout", "../slideLayouts/slideLayout1.xml")]),
            )
        )
    return entries


# ─── DOCX ────────────────────────────────────────────────────

DOCX_STYLES = (
    XML_DECL
    + f'<w:styles xmlns:w="{NS_W}">'
    + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="PingFang SC"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="56"/></w:rPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="280" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="1F3864"/></w:rPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="1"/><w:spacing w:before="240" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="2E4A9E"/></w:rPr></w:style>'
    + "</w:styles>"
)


def build_docx(spec: dict) -> list[tuple[str, str]]:
    paragraphs = spec.get("paragraphs")
    if not isinstance(paragraphs, list) or not paragraphs:
        fail("docx spec 需要 paragraphs 数组（至少一段）")
    title = next(
        (
            item.get("text", "")
            for item in paragraphs
            if isinstance(item, dict) and item.get("style") == "Title"
        ),
        "Document",
    )

    body_parts: list[str] = []
    for item in paragraphs:
        if isinstance(item, str):
            style, text = "Normal", item
        elif isinstance(item, dict) and "text" in item:
            style = item.get("style") or "Normal"
            if style not in ("Normal", "Title", "Heading1", "Heading2"):
                fail(f"未知段落样式：{style}（可选 Normal / Title / Heading1 / Heading2）")
            text = item["text"]
        else:
            fail("paragraphs 的每项须为字符串或 {style, text} 对象")
        body_parts.append(
            f'<w:p><w:pPr><w:pStyle w:val="{style}"/></w:pPr>'
            + f'<w:r><w:t xml:space="preserve">{esc(text)}</w:t></w:r></w:p>'
        )
    document = XML_DECL + (
        f'<w:document xmlns:w="{NS_W}"><w:body>'
        + "".join(body_parts)
        + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
        + '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>'
        + "</w:body></w:document>"
    )

    overrides = [
        ("/word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"),
        ("/word/styles.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"),
    ]
    entries: list[tuple[str, str]] = [
        ("[Content_Types].xml", content_types(overrides)),
        ("_rels/.rels", root_rels("word/document.xml")),
    ]
    entries.extend(doc_props(title))
    entries.append(("word/document.xml", document))
    entries.append(
        ("word/_rels/document.xml.rels", rels([("rId1", NS_R + "/styles", "styles.xml")]))
    )
    entries.append(("word/styles.xml", DOCX_STYLES))
    return entries


# ─── XLSX ────────────────────────────────────────────────────

XLSX_STYLES = (
    XML_DECL
    + f'<x:styleSheet xmlns:x="{NS_X}">'
    + '<x:fonts count="1"><x:font><x:sz val="11"/><x:name val="Calibri"/></x:font></x:fonts>'
    + '<x:fills count="2"><x:fill><x:patternFill patternType="none"/></x:fill><x:fill><x:patternFill patternType="gray125"/></x:fill></x:fills>'
    + '<x:borders count="1"><x:border/></x:borders>'
    + '<x:cellStyleXfs count="1"><x:xf/></x:cellStyleXfs>'
    + '<x:cellXfs count="1"><x:xf xfId="0"/></x:cellXfs>'
    + "</x:styleSheet>"
)


def column_letter(index: int) -> str:
    letters = ""
    while index >= 0:
        letters = chr(65 + index % 26) + letters
        index = index // 26 - 1
    return letters


def build_xlsx(spec: dict) -> list[tuple[str, str]]:
    sheets = spec.get("sheets")
    if not isinstance(sheets, list) or not sheets:
        fail("xlsx spec 需要 sheets 数组（至少一个工作表）")

    sheet_parts: list[tuple[str, str]] = []
    for index, sheet in enumerate(sheets):
        if not isinstance(sheet, dict) or not sheet.get("name"):
            fail(f"第 {index + 1} 个工作表缺少 name")
        rows = sheet.get("rows") or []
        if not isinstance(rows, list):
            fail(f"工作表 {sheet['name']} 的 rows 必须是数组")
        row_xml: list[str] = []
        for r_index, row in enumerate(rows):
            if not isinstance(row, list):
                fail(f"工作表 {sheet['name']} 第 {r_index + 1} 行必须是数组")
            cells: list[str] = []
            for c_index, value in enumerate(row):
                ref = f"{column_letter(c_index)}{r_index + 1}"
                if isinstance(value, bool):
                    cells.append(
                        f'<c r="{ref}" t="b"><v>{1 if value else 0}</v></c>'
                    )
                elif isinstance(value, (int, float)):
                    cells.append(f'<c r="{ref}"><v>{value}</v></c>')
                else:
                    cells.append(
                        f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{esc(value)}</t></is></c>'
                    )
            row_xml.append(f'<x:row r="{r_index + 1}">{"".join(cells)}</x:row>')
        sheet_xml = XML_DECL + (
            f'<x:worksheet xmlns:x="{NS_X}"><x:sheetData>'
            + "".join(row_xml)
            + "</x:sheetData></x:worksheet>"
        )
        sheet_parts.append((f"xl/worksheets/sheet{index + 1}.xml", sheet_xml))

    overrides = [
        ("/xl/workbook.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"),
        ("/xl/styles.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"),
    ] + [
        (part, "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml")
        for part, _ in sheet_parts
    ]

    sheet_elems = "".join(
        f'<x:sheet name="{esc(sheet["name"])}" sheetId="{i + 1}" r:id="rId{i + 1}"/>'
        for i, sheet in enumerate(sheets)
    )
    workbook = XML_DECL + (
        f'<x:workbook xmlns:x="{NS_X}" xmlns:r="{NS_R}"><x:sheets>{sheet_elems}</x:sheets></x:workbook>'
    )
    workbook_rels = [
        (f"rId{i + 1}", NS_R + "/worksheet", f"worksheets/sheet{i + 1}.xml")
        for i in range(len(sheets))
    ] + [(f"rId{len(sheets) + 1}", NS_R + "/styles", "styles.xml")]

    entries: list[tuple[str, str]] = [
        ("[Content_Types].xml", content_types(overrides)),
        ("_rels/.rels", root_rels("xl/workbook.xml")),
        ("xl/workbook.xml", workbook),
        ("xl/_rels/workbook.xml.rels", rels(workbook_rels)),
        ("xl/styles.xml", XLSX_STYLES),
    ]
    first_title = str(
        (sheets[0].get("rows") or [[]])[0][0] if (sheets[0].get("rows")) else "Workbook"
    )
    entries.extend(doc_props(first_title))
    entries.extend(sheet_parts)
    return entries


# ─── 入口 ────────────────────────────────────────────────────

BUILDERS = {"pptx": build_pptx, "docx": build_docx, "xlsx": build_xlsx}


def main(argv: list[str]) -> None:
    if len(argv) != 4 or argv[1] not in BUILDERS:
        print(
            "用法: python3 gen_office.py <pptx|docx|xlsx> <输出文件> <spec.json>",
            file=sys.stderr,
        )
        sys.exit(2)
    kind, output, spec_path = argv[1], argv[2], argv[3]
    try:
        with open(spec_path, encoding="utf-8") as handle:
            spec = json.load(handle)
    except OSError as error:
        fail(f"读取 spec 失败：{error}")
    except json.JSONDecodeError as error:
        fail(f"spec 不是合法 JSON：{error}")
    if not isinstance(spec, dict):
        fail("spec 顶层必须是 JSON 对象")
    entries = BUILDERS[kind](spec)
    write_zip(output, entries)
    print(f"OK {output}（{len(entries)} 个部件）")


if __name__ == "__main__":
    main(sys.argv)
