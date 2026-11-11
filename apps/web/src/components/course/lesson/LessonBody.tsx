'use client';

import React from 'react';
import { Code, ExternalLink, FileText } from 'lucide-react';
import { VideoPlayer } from '@/components/VideoPlayer';
import { ScormFrame } from '@/components/ScormFrame';
import { useLocale } from '@/lib/i18n';
import type { Lesson } from './types';

const NoContent: React.FC = () => {
  const { t } = useLocale();
  return (
    <p className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-xs text-ink-muted">
      {t('learn.lesson.noContent')}
    </p>
  );
};

export const LessonBody: React.FC<{
  lesson: Lesson;
  userEmail?: string;
  onScormCompleted: (lessonId: string) => void;
  onOpenCodeLab?: (lesson: { title: string; instructions: string }) => void;
}> = ({ lesson, userEmail, onScormCompleted, onOpenCodeLab }) => {
  const { t } = useLocale();

  if (lesson.contentType === 'SCORM_PACKAGE') {
    return lesson.scormPackageId ? (
      <ScormFrame key={lesson.id} packageId={lesson.scormPackageId} title={lesson.title} onCompleted={() => onScormCompleted(lesson.id)} />
    ) : (
      <NoContent />
    );
  }

  const text = lesson.bodyContent?.trim();
  const link = lesson.contentType === 'EXTERNAL_LTI_TOOL' ? lesson.ltiToolLaunchUrl : lesson.mediaUrl;
  const paragraphs = text ? text.split(/\n{2,}/) : [];
  const textBlock = paragraphs.length > 0 && (
    <div className="space-y-3 rounded-2xl border border-line bg-canvas p-6 md:p-8">
      {paragraphs.map((p, i) => (
        <p key={i} className="whitespace-pre-line text-sm leading-relaxed text-ink">
          {p}
        </p>
      ))}
    </div>
  );

  if (lesson.contentType === 'VIDEO') {
    return (
      <div className="space-y-4">
        {lesson.mediaUrl ? (
          <VideoPlayer key={lesson.id} url={lesson.mediaUrl} title={lesson.title} watermark={userEmail} />
        ) : (
          !textBlock && <NoContent />
        )}
        {textBlock}
      </div>
    );
  }

  if (lesson.contentType === 'INTERACTIVE_CODE') {
    return (
      <div className="space-y-4">
        {textBlock}
        {onOpenCodeLab && (
          <button
            onClick={() => onOpenCodeLab({ title: lesson.title, instructions: lesson.bodyContent ?? '' })}
            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-on-brand shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-500"
          >
            <Code className="h-4 w-4" />
            <span>{t('learn.lesson.openSandbox')}</span>
          </button>
        )}
        {!textBlock && !onOpenCodeLab && <NoContent />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {textBlock}
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-xs font-bold text-ink transition-colors hover:bg-raised"
        >
          {lesson.contentType === 'PDF_DOCUMENT' ? (
            <FileText className="h-4 w-4 text-orchid" />
          ) : (
            <ExternalLink className="h-4 w-4 text-brand-fg" />
          )}
          <span>{lesson.contentType === 'PDF_DOCUMENT' ? t('learn.lesson.openDocument') : t('learn.lesson.openNewTab')}</span>
        </a>
      )}
      {!textBlock && !link && <NoContent />}
    </div>
  );
};
