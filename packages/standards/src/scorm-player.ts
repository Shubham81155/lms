import { Scorm12CmiData, Scorm2004CmiData } from './index';

/**
 * Enterprise SCORM 1.2 & SCORM 2004 Browser Bridge Implementation
 * Exposes standard window.API (1.2) and window.API_1484_11 (2004) to embedded iframes.
 */

export interface ScormEventListener {
  onCommit: (data: Record<string, string>) => void;
  onFinish: (data: Record<string, string>) => void;
}

export class Scorm12RuntimeAdapter {
  private cmi: Record<string, string> = {};
  private isInitialized = false;
  private isFinished = false;
  private listener?: ScormEventListener;

  constructor(initialData?: Partial<Scorm12CmiData>, listener?: ScormEventListener) {
    this.listener = listener;
    this.cmi = {
      'cmi.core.student_id': 'usr_mock_001',
      'cmi.core.student_name': 'Chen, Alex',
      'cmi.core.lesson_location': '',
      'cmi.core.credit': 'credit',
      'cmi.core.lesson_status': 'not attempted',
      'cmi.core.entry': 'ab-initio',
      'cmi.core.score.raw': '0',
      'cmi.core.lesson_mode': 'normal',
      ...initialData,
    };
  }

  public LMSInitialize(param: string): string {
    if (this.isInitialized) return 'false';
    this.isInitialized = true;
    this.isFinished = false;
    return 'true';
  }

  public LMSGetValue(element: string): string {
    if (!this.isInitialized || this.isFinished) return '';
    return this.cmi[element] || '';
  }

  public LMSSetValue(element: string, value: string): string {
    if (!this.isInitialized || this.isFinished) return 'false';
    this.cmi[element] = value;
    return 'true';
  }

  public LMSCommit(param: string): string {
    if (!this.isInitialized || this.isFinished) return 'false';
    if (this.listener) {
      this.listener.onCommit({ ...this.cmi });
    }
    return 'true';
  }

  public LMSFinish(param: string): string {
    if (!this.isInitialized || this.isFinished) return 'false';
    this.isFinished = true;
    if (this.listener) {
      this.listener.onFinish({ ...this.cmi });
    }
    return 'true';
  }

  public LMSGetLastError(): string {
    return '0';
  }

  public LMSGetErrorString(errorCode: string): string {
    return 'No error';
  }

  public LMSGetDiagnostic(errorCode: string): string {
    return 'OK';
  }
}

export class Scorm2004RuntimeAdapter {
  private cmi: Record<string, string> = {};
  private isInitialized = false;
  private isTerminated = false;
  private listener?: ScormEventListener;

  constructor(initialData?: Partial<Scorm2004CmiData>, listener?: ScormEventListener) {
    this.listener = listener;
    this.cmi = {
      'cmi.completion_status': 'not attempted',
      'cmi.success_status': 'unknown',
      'cmi.score.scaled': '0.0',
      'cmi.progress_measure': '0.0',
      ...initialData,
    };
  }

  public Initialize(param: string): string {
    if (this.isInitialized) return 'false';
    this.isInitialized = true;
    this.isTerminated = false;
    return 'true';
  }

  public GetValue(element: string): string {
    if (!this.isInitialized || this.isTerminated) return '';
    return this.cmi[element] || '';
  }

  public SetValue(element: string, value: string): string {
    if (!this.isInitialized || this.isTerminated) return 'false';
    this.cmi[element] = value;
    return 'true';
  }

  public Commit(param: string): string {
    if (!this.isInitialized || this.isTerminated) return 'false';
    if (this.listener) {
      this.listener.onCommit({ ...this.cmi });
    }
    return 'true';
  }

  public Terminate(param: string): string {
    if (!this.isInitialized || this.isTerminated) return 'false';
    this.isTerminated = true;
    if (this.listener) {
      this.listener.onFinish({ ...this.cmi });
    }
    return 'true';
  }

  public GetLastError(): string {
    return '0';
  }

  public GetErrorString(errorCode: string): string {
    return 'No error';
  }

  public GetDiagnostic(errorCode: string): string {
    return 'OK';
  }
}
