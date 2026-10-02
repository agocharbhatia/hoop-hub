import { clipExportService, type ClipExportService } from './service';

let testService: ClipExportService | null = null;
export function getClipExportService(): ClipExportService { return testService ?? clipExportService; }
export function _setClipExportServiceForTests(service: ClipExportService | null): void { testService = service; }
