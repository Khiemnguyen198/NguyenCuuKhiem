"""Browser checks for import integrity; run `python test/browser-regression.py`.

Requires Python Playwright and Chromium (or CHROMIUM_EXECUTABLE). Vite uses a
fresh PLANNER_DATA_DIR and generated workbooks; no existing database is touched.
"""
import contextlib
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = r"""
import * as XLSX from 'xlsx';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
const directory = process.argv[1];
const headers = ['LINE','CUS','REF','COLOR','PO','LINE QTY','HÌNH IN','INPUT','OUTPUT','MODEL CODE','Leadtime'];
for (const [name,quantity,printCount] of [
 ['valid.xlsx',10,2],['new.xlsx',5,1],['saved-unrefreshed.xlsx',7,1],['inflight-latest.xlsx',8,1],
 ['invalid-print.xlsx',10,'hai'],['negative.xlsx',-1,2],['blank-quantity.xlsx',null,2]
]) {
 const book=XLSX.utils.book_new();
 const sheet=XLSX.utils.aoa_to_sheet([[],[],[],[],headers,
 [1,'Khách Việt','REF1','1234567-BLUE','PO001',quantity,printCount,new Date(2026,9,29),new Date(2026,9,30),'MODEL1','1 ngày']]);
 XLSX.utils.book_append_sheet(book,sheet,'TH');
 writeFileSync(resolve(directory,name),XLSX.write(book,{type:'buffer',bookType:'xlsx'}));
}
"""


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


@contextlib.contextmanager
def vite_server(data_directory, static=False, base="/"):
    port = free_port()
    environment = os.environ.copy()
    environment['PLANNER_DATA_DIR'] = str(data_directory)
    environment['VITE_STATIC_PAGES'] = 'true' if static else 'false'
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with tempfile.TemporaryFile(mode='w+') as log:
        process = subprocess.Popen(
            ['node', 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1',
             '--port', str(port), '--strictPort', '--base', base], cwd=ROOT, env=environment,
            stdout=log, stderr=subprocess.STDOUT)
        url = f'http://127.0.0.1:{port}{base}'
        try:
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    break
                try:
                    with opener.open(url, timeout=1) as response:
                        if response.status == 200:
                            yield url
                            return
                except (urllib.error.URLError, TimeoutError):
                    time.sleep(.1)
            log.seek(0)
            raise RuntimeError('Vite startup failed:\n' + log.read())
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


def wait_ready(page, url):
    page.goto(url)
    expect(page.locator('#storageStatus')).not_to_contain_text('Đang kết nối')
    expect(page.locator('[data-pick-file="booking"]')).to_be_enabled()


def upload(page, fixtures, name):
    page.locator('[data-file-input="booking"]').set_input_files(str(fixtures / name))
    expect(page.locator('[data-pick-file="booking"]')).to_be_enabled()


def close_changes(page):
    modal = page.locator('#changesModal')
    if modal.get_attribute('aria-hidden') == 'false':
        modal.locator('.icon-button[data-close-changes]').click()


def local_checks(browser, url, fixtures, database_directory):
    context = browser.new_context(timezone_id='Asia/Ho_Chi_Minh', viewport={'width':1440,'height':1024})
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    wait_ready(page, url)
    expect(page.locator('#originalCount')).to_have_text('0')
    assert 'DECATHLON' not in page.locator('#filename').inner_text()
    upload(page, fixtures, 'valid.xlsx')
    expect(page.locator('#sourceMeta-booking')).to_contain_text('valid.xlsx')
    expect(page.locator('#filename')).to_have_text('valid.xlsx')
    expect(page.locator('#totalQuantity')).to_have_text('10')
    expect(page.locator('#totalImpressions')).to_have_text('20')
    page.reload()
    expect(page.locator('#sourceMeta-booking')).to_contain_text('valid.xlsx')
    with sqlite3.connect(database_directory / 'planner.db') as database:
        dates = database.execute('SELECT input_date,output_date FROM booking_rows ORDER BY id DESC LIMIT 1').fetchone()
        assert dates == ('2026-10-29','2026-10-30'), dates
        original_count = database.execute('SELECT count(*) FROM imports').fetchone()[0]
    print('PASS: actual workbook, Vietnam dates and SQLite reload')

    for name in ['invalid-print.xlsx','negative.xlsx','blank-quantity.xlsx']:
        upload(page, fixtures, name)
        expect(page.locator('#toast')).to_have_class('toast toast--visible toast--error')
        expect(page.locator('#filename')).to_have_text('valid.xlsx')
        expect(page.locator('#totalImpressions')).to_have_text('20')
    with sqlite3.connect(database_directory / 'planner.db') as database:
        assert database.execute('SELECT count(*) FROM imports').fetchone()[0] == original_count
    print('PASS: invalid numbers rejected before any persistence')

    def fail_save(route):
        if route.request.method == 'POST':
            route.fulfill(status=500,content_type='application/json',body='{"error":"Lỗi lưu thử nghiệm"}')
        else:
            route.continue_()
    page.route('**/api/imports', fail_save)
    upload(page, fixtures, 'new.xlsx')
    expect(page.locator('#pendingBooking')).to_be_visible()
    expect(page.locator('#pendingBooking')).to_contain_text('new.xlsx')
    expect(page.locator('#filename')).to_have_text('valid.xlsx')
    expect(page.locator('#totalImpressions')).to_have_text('20')
    expect(page.locator('#retryBooking')).to_be_enabled()
    page.unroute('**/api/imports',fail_save)
    page.locator('#retryBooking').click()
    expect(page.locator('#pendingBooking')).to_be_hidden()
    expect(page.locator('#sourceMeta-booking')).to_contain_text('new.xlsx')
    expect(page.locator('#totalImpressions')).to_have_text('5')
    close_changes(page)
    page.reload()
    expect(page.locator('#sourceMeta-booking')).to_contain_text('new.xlsx')
    print('PASS: failed save preserves previous data; retry persists and reloads')

    page.locator('.nav__item[data-page="Kế hoạch"]').click()
    old_plan=page.locator('#planFiles .plan-row').filter(has_text='valid.xlsx').first
    old_id=old_plan.get_attribute('data-plan-id')
    old_plan.click()
    expect(page.locator('#filename')).to_have_text('valid.xlsx')
    page.locator('.nav__item[data-page="Tổng quan"]').click()
    expect(page.locator('#sourceMeta-booking')).to_contain_text('new.xlsx')
    print('PASS: historical plan totals never replace newest booking used by overview/FIFO')

    held=[]
    history_pattern='**/api/dashboard?id='+old_id
    page.route(history_pattern,lambda route:held.append(route))
    page.locator('.nav__item[data-page="Kế hoạch"]').click()
    with page.expect_request(lambda request:'/api/dashboard?id='+old_id in request.url):
        page.locator('#planFiles .plan-row').filter(has_text='valid.xlsx').first.click()
    upload(page,fixtures,'new.xlsx')
    expect(page.locator('#filename')).to_have_text('new.xlsx')
    assert len(held)==1,held
    with page.expect_response(lambda response:'/api/dashboard?id='+old_id in response.url):
        held[0].continue_()
    page.unroute(history_pattern)
    # Flush response-body parsing and the async history handler before checking.
    page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    expect(page.locator('#filename')).to_have_text('new.xlsx')
    print('PASS: delayed historical response cannot replace the file imported meanwhile')

    # A failed history load keeps the current saved metrics and shows a durable error.
    page.route('**/api/dashboard?*', lambda route: route.fulfill(
        status=500,content_type='application/json',body='{"error":"Unavailable"}'))
    page.locator('.nav__item[data-page="Kế hoạch"]').click()
    page.locator('#planFiles .plan-row').first.click()
    expect(page.locator('#storageNotice')).to_have_class('storage-notice storage-notice--error')
    expect(page.locator('#filename')).to_have_text('new.xlsx')
    expect(page.locator('#totalImpressions')).to_have_text('5')
    page.unroute('**/api/dashboard?*')
    print('PASS: failed dashboard request cannot replace saved data with demo figures')

    page.locator('.nav__item[data-page="Tổng quan"]').click()
    page.route('**/api/booking-rows?*',lambda route:route.fulfill(
        status=500,content_type='application/json',body='{"error":"Unavailable"}'))
    upload(page, fixtures, 'saved-unrefreshed.xlsx')
    expect(page.locator('#pendingBooking')).to_be_hidden()
    expect(page.locator('#storageNotice')).to_have_class('storage-notice storage-notice--error')
    expect(page.locator('#filename')).to_have_text('new.xlsx')
    expect(page.locator('#totalImpressions')).to_have_text('5')
    page.unroute('**/api/booking-rows?*')
    page.reload()
    expect(page.locator('#sourceMeta-booking')).to_contain_text('saved-unrefreshed.xlsx')
    expect(page.locator('#totalImpressions')).to_have_text('7')
    print('PASS: detail-load failure keeps old screen; successfully saved file returns on reload')

    # The inverse race: while the newest booking's detail is loading, viewing an
    # older plan must not prevent the overview/FIFO data from refreshing.
    detail_routes=[]
    detail_pattern='**/api/booking-rows?*'
    def hold_newest_detail(route):
        detail_routes.append(route)
        page.evaluate('window.__testDetailHeld = true')
    page.route(detail_pattern,hold_newest_detail)
    with page.expect_request(lambda request:'/api/booking-rows?' in request.url):
        with page.expect_response(lambda response:response.url.endswith('/api/imports') and response.request.method=='POST'):
            page.locator('[data-file-input="booking"]').set_input_files(str(fixtures/'inflight-latest.xlsx'))
    page.wait_for_function('window.__testDetailHeld === true')
    assert len(detail_routes)==1,detail_routes
    page.locator('.nav__item[data-page="Kế hoạch"]').click()
    page.locator('#planFiles .plan-row').filter(has_text='valid.xlsx').first.click()
    expect(page.locator('#filename')).to_have_text('valid.xlsx')
    expect(page.locator('#totalImpressions')).to_have_text('20')
    with page.expect_response(lambda response:'/api/booking-rows?' in response.url):
        detail_routes[0].continue_()
    page.unroute(detail_pattern)
    expect(page.locator('[data-pick-file="booking"]')).to_be_enabled()
    expect(page.locator('#sourceMeta-booking')).to_contain_text('inflight-latest.xlsx')
    expect(page.locator('#filename')).to_have_text('valid.xlsx')
    expect(page.locator('#totalImpressions')).to_have_text('20')
    close_changes(page)
    page.locator('.nav__item[data-page="Tổng quan"]').click()
    expect(page.locator('#sourceMeta-booking')).to_contain_text('inflight-latest.xlsx')
    print('PASS: selecting historical totals during newest detail refresh preserves both views correctly')

    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Body overflow on mobile'
    for name in ['Tổng quan','Theo mã hàng','Kế hoạch']:
        expect(page.get_by_role('button',name=name,exact=True)).to_be_visible()
    assert not errors, errors
    print('PASS: mobile width, accessible navigation and zero uncaught script errors')

    failed_sources=context.new_page()
    failed_sources.route('**/api/sources?*',lambda route:route.fulfill(
        status=500,content_type='application/json',body='{"error":"Source unavailable"}'))
    wait_ready(failed_sources,url)
    expect(failed_sources.locator('#sourceMeta-booking')).to_contain_text('inflight-latest.xlsx')
    expect(failed_sources.locator('#storageNotice')).to_have_class('storage-notice storage-notice--error')
    expect(failed_sources.locator('#storageNotice')).to_contain_text('Không đọc được nguồn')
    print('PASS: receipt/delivery HTTP errors remain visible after the booking loads successfully')
    context.close()


def static_checks(browser, url, fixtures):
    context=browser.new_context(timezone_id='Asia/Ho_Chi_Minh',viewport={'width':1440,'height':1024})
    page=context.new_page()
    errors=[]
    api_calls=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.on('request',lambda request:api_calls.append(request.url) if '/api/' in request.url else None)
    wait_ready(page,url)
    upload(page,fixtures,'valid.xlsx')
    expect(page.locator('#filename')).to_have_text('valid.xlsx')
    expect(page.locator('#totalImpressions')).to_have_text('20')
    assert 'mẫu' not in page.locator('#fileMeta').inner_text().lower()
    assert 'không lưu sqlite' in page.locator('#fileMeta').inner_text().lower()
    page.reload()
    expect(page.locator('#sourceMeta-booking')).to_contain_text('valid.xlsx')
    previous=page.evaluate('''() => ({rows:localStorage.getItem('planner-booking-rows'),history:localStorage.getItem('planner-file-history')})''')
    page.evaluate('''() => {
      const original = Storage.prototype.setItem;
      window.failNextHistoryWrite = true;
      Storage.prototype.setItem = function(key, value) {
        if (key === 'planner-file-history' && window.failNextHistoryWrite) {
          window.failNextHistoryWrite=false;
          throw new DOMException('Test quota exceeded','QuotaExceededError');
        }
        return original.call(this,key,value);
      };
    }''')
    upload(page,fixtures,'new.xlsx')
    expect(page.locator('#pendingBooking')).to_be_visible()
    expect(page.locator('#filename')).to_have_text('valid.xlsx')
    current=page.evaluate('''() => ({rows:localStorage.getItem('planner-booking-rows'),history:localStorage.getItem('planner-file-history')})''')
    assert current==previous,'Quota failure partially replaced booking/history storage'
    page.locator('#retryBooking').click()
    expect(page.locator('#pendingBooking')).to_be_hidden()
    expect(page.locator('#filename')).to_have_text('new.xlsx')
    expect(page.locator('#totalImpressions')).to_have_text('5')
    close_changes(page)
    page.reload()
    expect(page.locator('#sourceMeta-booking')).to_contain_text('new.xlsx')
    expect(page.locator('#totalImpressions')).to_have_text('5')
    upload(page,fixtures,'invalid-print.xlsx')
    expect(page.locator('#toast')).to_have_class('toast toast--visible toast--error')
    expect(page.locator('#filename')).to_have_text('new.xlsx')
    assert not api_calls,api_calls
    assert not errors,errors
    print('PASS: static storage labels/reload; quota rollback and retry; no API writes or invalid totals')
    context.close()


def main():
    executable=os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium') or shutil.which('google-chrome')
    with tempfile.TemporaryDirectory(prefix='inkava-latest-browser-') as directory:
        temporary=Path(directory)
        subprocess.run(['node','--input-type=module','-e',FIXTURES,str(temporary)],cwd=ROOT,check=True)
        with sync_playwright() as playwright:
            browser=playwright.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox'])
            try:
                with vite_server(temporary/'local-data') as url:
                    local_checks(browser,url,temporary,temporary/'local-data')
                with vite_server(temporary/'base-data',base='/custom/') as url:
                    context=browser.new_context(timezone_id='Asia/Ho_Chi_Minh')
                    page=context.new_page()
                    wait_ready(page,url)
                    expect(page.locator('#storageStatus')).to_contain_text('SQLite đã kết nối')
                    upload(page,temporary,'valid.xlsx')
                    expect(page.locator('#sourceMeta-booking')).to_contain_text('valid.xlsx')
                    context.close()
                    print('PASS: non-root dev base keeps SQLite mode and working API requests')
                with vite_server(temporary/'static-data',static=True) as url:
                    static_checks(browser,url,temporary)
                assert not (temporary/'static-data'/'planner.db').exists(),'Static mode opened SQLite'
            finally:
                browser.close()
    print('All browser regression checks passed.')


if __name__=='__main__':
    main()
