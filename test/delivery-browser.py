"""End-to-end delivery dates in local SQLite and browser storage.

Requires Python Playwright and Chromium; all workbooks and SQLite databases are
created in a temporary directory and never touch the user's existing database.
"""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('planner_browser_tests', ROOT / 'test/browser-regression.py')
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)

FIXTURES = r"""
import * as XLSX from 'xlsx';
import {resolve} from 'node:path';
import {writeFileSync} from 'node:fs';
const folder=process.argv[1];
const serial=s=>Math.floor((Date.parse(s+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000);
const write=(file,name,table)=>{const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(table),name);writeFileSync(resolve(folder,file),XLSX.write(book,{type:'buffer',bookType:'xlsx'}));};
const header=['LINE','CUS','REF','COLOR','PO','SS','LINE QTY','INPUT','OUTPUT','MODEL CODE','SỐ PHIẾU','SLHĐ TỔNG','HÌNH IN','Leadtime'];
write('booking.xlsx','TH',[[],[],[],[],header,
 [1,'DECATHLON','353234','9046670 BLUE','PO-1','SS27',10,serial('2026-10-01'),serial('2026-11-09'),'9046670','70001',10,1,'1 ngày'],
 [2,'DECATHLON','353234','9046670 BLUE','PO-2','SS27',15,serial('2026-10-02'),serial('2026-11-10'),'9046670','70002',15,1,'2 ngày'],
 [3,'DECATHLON','353234','9046670 BLUE','PO-3','SS27',20,serial('2026-10-03'),serial('2026-11-11'),'9046670','70003',20,1,'3 ngày']]);
write('receipts.xlsx','DATA',[
 ['NGÀY NHẬN','KHÁCH HÀNG','MÃ HÀNG','MÀU','PO','SS','TỔNG NHẬN','TỔNG XUẤT'],
 [serial('2026-10-30'),'DECATHLON','353234','9046670 BLUE','70001','SS27',10,0],
 [serial('2026-10-31'),'DECATHLON','353234','9046670 BLUE','70002','SS27',15,0]]);
write('deliveries.xlsx','TỔNG HỢP',[
 ['PO','MÃ HÀNG','MÀU','MÙA','HÌNH IN','KHÁCH HÀNG','TỔNG NHẬN','TỔNG GIAO','GIAO ĐẠT','PO','FULL PO','NGÀY GIAO THỰC TẾ'],
 ['PO-1','353234','9046670 BLUE','SS27','ORBIT','DECATHLON',10,10,10,'70001','PO-1',serial('2026-11-04')],
 ['PO-2','353234','9046670 BLUE','SS27','ORBIT','DECATHLON',15,15,15,'70002','PO-2',serial('2026-11-04')]]);
"""

CHECK_EXPORT = r"""
import * as XLSX from 'xlsx';
import {readFileSync} from 'node:fs';
const wb=XLSX.read(readFileSync(process.argv[1]),{type:'buffer',cellDates:false,cellNF:true});
const sheet=wb.Sheets['KE HOACH GIAO HANG'];
const rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:null,raw:true});
const idx=name=>{let i=rows[0].indexOf(name);if(i<0)throw new Error('Missing column '+name+': '+rows[0].join('|'));return i;};
const names=['PO','NGÀY NHẬN','NGÀY GIAO HỢP ĐỒNG','NGÀY GIAO THỰC TẾ','NGÀY GIAO DỰ KIẾN','CẢNH BÁO'];
const result=rows.slice(1).filter(row=>row[2]).map(row=>Object.fromEntries(names.map(name=>[name,row[idx(name)]])));
const converted=result.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,v instanceof Date ? v.toISOString().slice(0,10):v])));
console.log(JSON.stringify(converted));
"""


def upload(page, directory, kind, filename):
    page.locator(f'[data-file-input="{kind}"]').set_input_files(str(directory / filename))
    expect(page.locator(f'[data-pick-file="{kind}"]')).to_be_enabled()
    expect(page.locator(f'#sourceMeta-{kind}')).to_contain_text(filename)


def data_row(page, po):
    return page.locator('#planTable tbody tr').filter(has=page.locator('td').get_by_text(po,exact=True))


def assert_cells(page, po, receipt, file_date, expected):
    row=data_row(page,po)
    expect(row).to_have_count(1)
    cells=row.locator('td')
    expect(cells.nth(8)).to_have_text(receipt)
    expect(cells.nth(10)).to_have_text(file_date)
    expect(cells.nth(11)).to_have_text(expected)
    return cells.nth(12).inner_text()


def check_mode(browser, url, directory, label):
    context=browser.new_context(timezone_id='Asia/Ho_Chi_Minh',viewport={'width':1440,'height':1024},accept_downloads=True)
    page=context.new_page()
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    helpers.wait_ready(page,url)
    upload(page,directory,'booking','booking.xlsx')
    upload(page,directory,'receipts','receipts.xlsx')
    upload(page,directory,'deliveries','deliveries.xlsx')
    page.locator('.nav__item[data-page="Kế hoạch"]').click()
    expect(page.locator('#planTable')).to_contain_text('PO-1')
    # Friday + (1+1) working days = Monday; Saturday + (2+1) = Wednesday.
    assert 'khác' in assert_cells(page,'PO-1','30/10/2026','04/11/2026','02/11/2026').lower()
    assert 'khác' not in assert_cells(page,'PO-2','31/10/2026','04/11/2026','04/11/2026').lower()
    assert_cells(page,'PO-3','—','—','—')
    with page.expect_download(timeout=15000) as download_info:
        page.locator('#exportFab').click()
    output=directory / f'export-{label}.xlsx'
    download_info.value.save_as(output)
    serialized=subprocess.run(['node','--input-type=module','-e',CHECK_EXPORT,str(output)],cwd=ROOT,check=True,capture_output=True,text=True,env={**os.environ, 'TZ':'UTC'})
    rows={row['PO']:row for row in json.loads(serialized.stdout)}
    assert rows['PO-1']['NGÀY NHẬN']=='2026-10-30',rows
    assert rows['PO-1']['NGÀY GIAO THỰC TẾ']=='2026-11-04',rows
    assert rows['PO-1']['NGÀY GIAO DỰ KIẾN']=='2026-11-02',rows
    assert 'khác' in rows['PO-1']['CẢNH BÁO'].lower(),rows
    assert rows['PO-2']['NGÀY GIAO DỰ KIẾN']=='2026-11-04',rows
    assert 'khác' not in rows['PO-2']['CẢNH BÁO'].lower(),rows
    assert rows['PO-3']['NGÀY NHẬN'] is None and rows['PO-3']['NGÀY GIAO DỰ KIẾN'] is None,rows
    assert not errors,errors
    context.close()
    print(f'PASS {label}: source files, per-PO dates and warnings, downloaded workbook')


def main():
    executable=os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium') or shutil.which('google-chrome')
    if not executable:
        raise RuntimeError('Chromium is required; set CHROMIUM_EXECUTABLE.')
    with tempfile.TemporaryDirectory(prefix='inkava-delivery-browser-') as tmp:
        directory=Path(tmp)
        subprocess.run(['node','--input-type=module','-e',FIXTURES,str(directory)],cwd=ROOT,check=True)
        with sync_playwright() as playwright:
            browser=playwright.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox'])
            try:
                with helpers.vite_server(directory/'local-data') as url:
                    check_mode(browser,url,directory,'local')
                with helpers.vite_server(directory/'static-data',static=True) as url:
                    check_mode(browser,url,directory,'static')
            finally:
                browser.close()
    print('All delivery browser checks passed.')


if __name__=='__main__':
    main()
