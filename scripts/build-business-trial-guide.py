from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "docs" / "KOL-CRM业务部门试用操作手册.docx"

BLUE = "176B6B"
DARK = "16324F"
HEADING_BLUE = "2E74B5"
HEADING_DARK = "1F4D78"
LIGHT_BLUE = "E8EEF5"
LIGHT_TEAL = "E8F4F2"
LIGHT_GOLD = "FFF6DF"
LIGHT_RED = "FDECEC"
GRAY = "667085"
BLACK = "1F2937"
WHITE = "FFFFFF"
BORDER = "CDD5DF"
FONT = "Microsoft YaHei"


def set_run_font(run, size=11, color=BLACK, bold=False, italic=False):
    run.font.name = FONT
    run._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), FONT)
    run._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), FONT)
    run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), FONT)
    run.font.size = Pt(size)
    run.font.color.rgb = RGBColor.from_string(color)
    run.bold = bold
    run.italic = italic


def shade_cell(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=80, start=120, bottom=80, end=120):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for name, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{name}"))
        if node is None:
            node = OxmlElement(f"w:{name}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_table_geometry(table, widths_dxa, indent_dxa=120):
    table.autofit = False
    tbl_pr = table._tbl.tblPr
    tbl_w = tbl_pr.find(qn("w:tblW"))
    if tbl_w is None:
        tbl_w = OxmlElement("w:tblW")
        tbl_pr.append(tbl_w)
    tbl_w.set(qn("w:w"), str(sum(widths_dxa)))
    tbl_w.set(qn("w:type"), "dxa")
    tbl_ind = tbl_pr.find(qn("w:tblInd"))
    if tbl_ind is None:
        tbl_ind = OxmlElement("w:tblInd")
        tbl_pr.append(tbl_ind)
    tbl_ind.set(qn("w:w"), str(indent_dxa))
    tbl_ind.set(qn("w:type"), "dxa")
    grid = table._tbl.tblGrid
    for child in list(grid):
        grid.remove(child)
    for width in widths_dxa:
        col = OxmlElement("w:gridCol")
        col.set(qn("w:w"), str(width))
        grid.append(col)
    for row in table.rows:
        for idx, cell in enumerate(row.cells):
            tc_pr = cell._tc.get_or_add_tcPr()
            tc_w = tc_pr.find(qn("w:tcW"))
            if tc_w is None:
                tc_w = OxmlElement("w:tcW")
                tc_pr.append(tc_w)
            tc_w.set(qn("w:w"), str(widths_dxa[idx]))
            tc_w.set(qn("w:type"), "dxa")
            set_cell_margins(cell)
            cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER


def add_field_page_number(paragraph):
    run = paragraph.add_run()
    fld_char1 = OxmlElement("w:fldChar")
    fld_char1.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = " PAGE "
    fld_char2 = OxmlElement("w:fldChar")
    fld_char2.set(qn("w:fldCharType"), "end")
    run._r.extend([fld_char1, instr, fld_char2])
    set_run_font(run, size=9, color=GRAY)


def configure_numbering(doc):
    numbering = doc.part.numbering_part.element
    abstract_id = 42
    abstract = OxmlElement("w:abstractNum")
    abstract.set(qn("w:abstractNumId"), str(abstract_id))
    multi = OxmlElement("w:multiLevelType")
    multi.set(qn("w:val"), "singleLevel")
    abstract.append(multi)
    lvl = OxmlElement("w:lvl")
    lvl.set(qn("w:ilvl"), "0")
    start = OxmlElement("w:start")
    start.set(qn("w:val"), "1")
    num_fmt = OxmlElement("w:numFmt")
    num_fmt.set(qn("w:val"), "decimal")
    lvl_text = OxmlElement("w:lvlText")
    lvl_text.set(qn("w:val"), "%1.")
    suff = OxmlElement("w:suff")
    suff.set(qn("w:val"), "tab")
    p_pr = OxmlElement("w:pPr")
    tabs = OxmlElement("w:tabs")
    tab = OxmlElement("w:tab")
    tab.set(qn("w:val"), "num")
    tab.set(qn("w:pos"), "540")
    tabs.append(tab)
    ind = OxmlElement("w:ind")
    ind.set(qn("w:left"), "540")
    ind.set(qn("w:hanging"), "270")
    spacing = OxmlElement("w:spacing")
    spacing.set(qn("w:after"), "80")
    spacing.set(qn("w:line"), "300")
    spacing.set(qn("w:lineRule"), "auto")
    p_pr.extend([tabs, ind, spacing])
    lvl.extend([start, num_fmt, lvl_text, suff, p_pr])
    abstract.append(lvl)
    numbering.append(abstract)
    for num_id in range(42, 50):
        num = OxmlElement("w:num")
        num.set(qn("w:numId"), str(num_id))
        abstract_ref = OxmlElement("w:abstractNumId")
        abstract_ref.set(qn("w:val"), str(abstract_id))
        num.append(abstract_ref)
        numbering.append(num)


def add_numbered(doc, text, num_id=42):
    p = doc.add_paragraph()
    p_pr = p._p.get_or_add_pPr()
    num_pr = OxmlElement("w:numPr")
    ilvl = OxmlElement("w:ilvl")
    ilvl.set(qn("w:val"), "0")
    num_id_node = OxmlElement("w:numId")
    num_id_node.set(qn("w:val"), str(num_id))
    num_pr.extend([ilvl, num_id_node])
    p_pr.append(num_pr)
    r = p.add_run(text)
    set_run_font(r)
    return p


def add_bullet(doc, text):
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.left_indent = Inches(0.375)
    p.paragraph_format.first_line_indent = Inches(-0.188)
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.line_spacing = 1.25
    r = p.add_run(text)
    set_run_font(r)
    return p


def add_callout(doc, title, body, fill=LIGHT_GOLD, title_color="7A5A00"):
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    cell = table.cell(0, 0)
    shade_cell(cell, fill)
    set_table_geometry(table, [9360])
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run(title)
    set_run_font(r, size=10.5, color=title_color, bold=True)
    p2 = cell.add_paragraph()
    p2.paragraph_format.space_after = Pt(0)
    p2.paragraph_format.line_spacing = 1.2
    r2 = p2.add_run(body)
    set_run_font(r2, size=10.5)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)


def add_kv_table(doc, rows):
    table = doc.add_table(rows=0, cols=2)
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    table.style = "Table Grid"
    for label, value in rows:
        cells = table.add_row().cells
        shade_cell(cells[0], LIGHT_BLUE)
        p0 = cells[0].paragraphs[0]
        p1 = cells[1].paragraphs[0]
        r0 = p0.add_run(label)
        r1 = p1.add_run(value)
        set_run_font(r0, size=10, color=DARK, bold=True)
        set_run_font(r1, size=10)
        p0.paragraph_format.space_after = Pt(0)
        p1.paragraph_format.space_after = Pt(0)
    set_table_geometry(table, [2700, 6660])
    doc.add_paragraph().paragraph_format.space_after = Pt(0)


def add_troubleshooting_table(doc):
    rows = [
        ("现象", "先检查", "处理方式"),
        ("同事打不开网页", "是否连接同一办公室 Wi-Fi", "确认地址为 http://172.26.6.161:3000；关闭代理重试；允许 Node.js 通过专用网络防火墙。"),
        ("批量按钮为灰色", "左侧是否显示 0/5", "先勾选 1-5 位达人；选中后按钮才会启用。"),
        ("找不到芝麻麻麻", "是否只看顶部初次建联", "芝麻麻麻已建联，位于页面下方“二次跟进”。"),
        ("话术一直生成", "AI 接口是否超时", "等待页面报错后重试；不要连续点击。记录达人姓名和时间反馈给管理员。"),
        ("私信发送失败", "专用 Chrome 是否登录抖音", "在主机上打开抖音确认登录和消息页；一次只让一人操作自动发送。"),
        ("同步不到回复", "回复是否已真实发送", "确认测试账号已回复；点击“同步会话”；若仍失败，检查专用 Chrome 消息入口。"),
    ]
    table = doc.add_table(rows=0, cols=3)
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    for ridx, row in enumerate(rows):
        cells = table.add_row().cells
        for cidx, value in enumerate(row):
            if ridx == 0:
                shade_cell(cells[cidx], BLUE)
            p = cells[cidx].paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.1
            r = p.add_run(value)
            set_run_font(r, size=9.2, color=WHITE if ridx == 0 else BLACK, bold=ridx == 0)
    set_table_geometry(table, [1900, 2600, 4860])
    table.rows[0]._tr.get_or_add_trPr().append(OxmlElement("w:tblHeader"))


doc = Document()
section = doc.sections[0]
section.page_width = Inches(8.5)
section.page_height = Inches(11)
section.top_margin = Inches(0.82)
section.bottom_margin = Inches(0.78)
section.left_margin = Inches(1.0)
section.right_margin = Inches(1.0)
section.header_distance = Inches(0.492)
section.footer_distance = Inches(0.492)

# Compact reference guide token map; page margins use a named compact manual override.
styles = doc.styles
normal = styles["Normal"]
normal.font.name = FONT
normal._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
normal.font.size = Pt(11)
normal.font.color.rgb = RGBColor.from_string(BLACK)
normal.paragraph_format.space_after = Pt(6)
normal.paragraph_format.line_spacing = 1.25
for name, size, color, before, after in (
    ("Heading 1", 16, HEADING_BLUE, 18, 10),
    ("Heading 2", 13, HEADING_BLUE, 14, 7),
    ("Heading 3", 12, HEADING_DARK, 10, 5),
):
    st = styles[name]
    st.font.name = FONT
    st._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    st.font.size = Pt(size)
    st.font.color.rgb = RGBColor.from_string(color)
    st.font.bold = True
    st.paragraph_format.space_before = Pt(before)
    st.paragraph_format.space_after = Pt(after)
    st.paragraph_format.keep_with_next = True

configure_numbering(doc)

header = section.header.paragraphs[0]
header.alignment = WD_ALIGN_PARAGRAPH.LEFT
hr = header.add_run("KOL CRM｜业务部门试用手册")
set_run_font(hr, size=9, color=GRAY, bold=True)
footer = section.footer.paragraphs[0]
footer.alignment = WD_ALIGN_PARAGRAPH.RIGHT
fr = footer.add_run("内部试用 · 第 ")
set_run_font(fr, size=9, color=GRAY)
add_field_page_number(footer)
fr2 = footer.add_run(" 页")
set_run_font(fr2, size=9, color=GRAY)

# Customer-pack opening block.
p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(4)
p.paragraph_format.space_after = Pt(2)
r = p.add_run("业务试用指南")
set_run_font(r, size=10, color=BLUE, bold=True)
p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(6)
r = p.add_run("KOL CRM 达人筛选与建联工作台")
set_run_font(r, size=25, color=DARK, bold=True)
p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(16)
r = p.add_run("产品营销部门｜局域网临时试用版｜2026 年 8 月")
set_run_font(r, size=12, color=GRAY)

add_callout(doc, "30 秒开始", "连接与主机相同的办公室 Wi-Fi，在浏览器打开 http://172.26.6.161:3000。不要使用 localhost；localhost 只代表访问者自己的电脑。", LIGHT_TEAL, BLUE)

add_kv_table(doc, [
    ("适用人员", "产品营销、达人运营、商务合作同事"),
    ("试用地址", "http://172.26.6.161:3000"),
    ("主机要求", "主机保持开机；Web、Worker、专用抖音 Chrome 持续运行"),
    ("测试账号", "芝麻麻麻（本人测试账号）"),
    ("重要限制", "当前没有登录保护；仅发给可信同事，一次只由一人执行自动私信"),
])

doc.add_heading("一、试用前准备", level=1)
add_numbered(doc, "确认你的电脑与主机连接同一个办公室 Wi-Fi，不要连接访客网络。", 42)
add_numbered(doc, "在浏览器打开 http://172.26.6.161:3000。若打不开，先关闭代理后重试。", 42)
add_numbered(doc, "由主机管理员确认 Web、Agent Worker 和专用抖音 Chrome 都在运行。", 42)
add_numbered(doc, "涉及自动私信前，确认专用 Chrome 已登录负责建联的抖音账号。", 42)
add_numbered(doc, "业务试用期间不要执行清空数据、批量删除或重复启动同一 Agent。", 42)

add_callout(doc, "安全提醒", "同一网络中知道地址的人都可能访问系统。试用期间不要把地址转发给办公室之外的人；测试结束后由管理员关闭服务或防火墙临时规则。", LIGHT_RED, "9B1C1C")

doc.add_heading("二、页面与推荐试用顺序", level=1)
steps = [
    ("Agent 工作台", "查看任务目标、启动自动筛选、观察采集与画像进度。"),
    ("达人发现", "按关键词查看采集结果和候选达人。"),
    ("达人复筛", "检查主页样本、画像结论和排除原因。"),
    ("达人库", "查看候选库、精选库及达人详情。"),
    ("建联任务", "生成个性化话术、人工确认并发送私信、同步回复。"),
]
table = doc.add_table(rows=0, cols=2)
table.style = "Table Grid"
for idx, (page, action) in enumerate(steps, start=1):
    cells = table.add_row().cells
    shade_cell(cells[0], LIGHT_BLUE)
    p0, p1 = cells[0].paragraphs[0], cells[1].paragraphs[0]
    r0, r1 = p0.add_run(f"{idx}. {page}"), p1.add_run(action)
    set_run_font(r0, size=10, color=DARK, bold=True)
    set_run_font(r1, size=10)
    p0.paragraph_format.space_after = Pt(0)
    p1.paragraph_format.space_after = Pt(0)
set_table_geometry(table, [2700, 6660])

doc.add_heading("三、完整测试：使用“芝麻麻麻”", level=1)
add_callout(doc, "为什么顶部找不到？", "芝麻麻麻当前已标记为“已建联”，因此不会出现在顶部“初次个性化建联”列表，而是在页面下方的“二次跟进”。这是正常状态。", LIGHT_TEAL, BLUE)
add_numbered(doc, "进入“建联任务”，选择“蜀黍家”下的“警校生-警察小熊”任务。", 43)
add_numbered(doc, "向下滚动到“二次跟进”，找到“芝麻麻麻”。", 43)
add_numbered(doc, "点击“AI生成话术”，阅读并按需要修改话术。", 43)
add_numbered(doc, "点击“确认并自动私信”；在确认弹窗中再次核对收件人和内容。", 43)
add_numbered(doc, "使用“芝麻麻麻”对应的抖音账号回复这条私信。", 43)
add_numbered(doc, "回到建联任务页面顶部“回复监控”，点击“同步会话”。", 43)
add_numbered(doc, "打开芝麻麻麻会话卡片，测试意图识别、回复草稿生成、人工修改和确认发送。", 43)

add_callout(doc, "发送边界", "点击最终确认会真实发送抖音私信，发送后不能由系统自动撤回。测试时只选择“芝麻麻麻”，不要选真实达人。", LIGHT_RED, "9B1C1C")

doc.add_heading("四、测试顶部“批量个性化建联”", level=1)
add_numbered(doc, "顶部显示 0/5 时，先勾选 1-5 位未建联达人；未勾选时绿色按钮为灰色。", 44)
add_numbered(doc, "建议首次只选 1 人，点击“批量生成个性化话术”。", 44)
add_numbered(doc, "逐条检查称呼、品牌、产品、合作目的和语气，不合适时直接编辑。", 44)
add_numbered(doc, "只有在确认收件人是真实要联系的达人后，才点击“检查后确认批量发送”。", 44)
add_numbered(doc, "批量发送期间保持页面和专用 Chrome 开启，不要由另一位同事同时发送。", 44)

doc.add_heading("五、业务部门重点验收内容", level=1)
for item in [
    "筛选出的达人是否符合目标人群，误选原因是什么。",
    "达人主页样本、数据和画像结论是否足以支持判断。",
    "个性化话术是否自然、是否准确引用品牌和产品。",
    "发送前的确认步骤是否清晰，是否容易误操作。",
    "回复同步、意图识别和回复草稿是否符合业务习惯。",
    "页面是否存在找不到入口、按钮含义不清或长时间等待的问题。",
]:
    add_bullet(doc, item)

doc.add_heading("六、常见问题", level=1)
add_troubleshooting_table(doc)

doc.add_heading("七、试用反馈模板", level=1)
add_kv_table(doc, [
    ("试用人 / 日期", "____________________________"),
    ("测试页面", "Agent / 达人发现 / 复筛 / 达人库 / 建联任务"),
    ("执行动作", "____________________________"),
    ("预期结果", "____________________________"),
    ("实际结果", "____________________________"),
    ("问题达人 / 时间", "____________________________"),
    ("是否阻断工作", "是 / 否"),
    ("建议", "____________________________"),
])

doc.add_heading("八、管理员收尾", level=1)
add_bullet(doc, "汇总业务反馈，优先记录阻断发送、重复发送、数据误删和回复同步失败。")
add_bullet(doc, "试用结束后关闭临时访问，或停止 Web 服务。")
add_bullet(doc, "正式公网试用前必须补充登录权限、操作审计、HTTPS 和数据库自动备份。")

OUT.parent.mkdir(parents=True, exist_ok=True)
doc.core_properties.title = "KOL CRM 业务部门试用操作手册"
doc.core_properties.subject = "产品营销部门局域网试用与完整建联测试"
doc.core_properties.author = "KOL CRM 项目组"
doc.save(OUT)
print(OUT)
