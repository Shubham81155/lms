'use client';

import React, { useState, useRef } from 'react';
import {
  X,
  User as UserIcon,
  Lock,
  Upload,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Shield,
  Loader2,
  Mail,
  Building,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { api, ApiError } from '@/lib/api';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { initialsOf, roleTitle } from '@/lib/navigation';
import { uploadAvatar } from '@/lib/upload';
import { useT } from '@/lib/i18n';
import clsx from 'clsx';

interface ProfileSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: 'profile' | 'password';
}

export const ProfileSettingsModal: React.FC<ProfileSettingsModalProps> = ({
  isOpen,
  onClose,
  defaultTab = 'profile',
}) => {
  useEscapeKey(onClose);
  const { user, refreshUser, updateUserSession } = useAuth();
  const t = useT();

  const [activeTab, setActiveTab] = useState<'profile' | 'password'>(defaultTab);

  // Profile Picture & Name State
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarImgError, setAvatarImgError] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);

  // External URL option
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [customAvatarUrl, setCustomAvatarUrl] = useState('');

  // Password State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  if (!isOpen || !user) return null;

  // Handle uploading avatar file
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      setAvatarError('Please select a valid image file (PNG, JPEG, WebP, or GIF)');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setAvatarError('Image file must be 5 MB or smaller');
      return;
    }

    setAvatarUploading(true);
    setAvatarError(null);
    setProfileSuccess(null);

    try {
      const newUrl = await uploadAvatar(file, user.id);
      updateUserSession({ avatarUrl: newUrl });
      await refreshUser();
      setAvatarImgError(false);
      setProfileSuccess('Profile picture updated successfully!');
    } catch (err: unknown) {
      setAvatarError(err instanceof Error ? err.message : 'Failed to upload profile picture');
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Handle saving custom avatar URL
  const handleSaveAvatarUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customAvatarUrl.trim()) return;

    setAvatarUploading(true);
    setAvatarError(null);
    setProfileSuccess(null);

    try {
      const data = await api.patch<{ data: { avatarUrl: string } }>(`/api/v1/users/${user.id}`, {
        avatarUrl: customAvatarUrl.trim(),
      });
      const newUrl = data.data.avatarUrl;
      updateUserSession({ avatarUrl: newUrl });
      await refreshUser();
      setAvatarImgError(false);
      setProfileSuccess('Profile picture URL saved!');
      setShowUrlInput(false);
      setCustomAvatarUrl('');
    } catch (err: unknown) {
      setAvatarError(err instanceof ApiError ? err.message : 'Failed to update avatar URL');
    } finally {
      setAvatarUploading(false);
    }
  };

  // Handle removing avatar
  const handleRemoveAvatar = async () => {
    setAvatarUploading(true);
    setAvatarError(null);
    setProfileSuccess(null);

    try {
      await api.delete(`/api/v1/users/${user.id}/avatar`);
      updateUserSession({ avatarUrl: null });
      await refreshUser();
      setProfileSuccess('Profile picture removed');
    } catch (err: unknown) {
      setAvatarError(err instanceof ApiError ? err.message : 'Failed to remove avatar');
    } finally {
      setAvatarUploading(false);
    }
  };

  // Handle saving name
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSaving(true);
    setAvatarError(null);
    setProfileSuccess(null);

    try {
      const trimmedFirst = firstName.trim();
      const trimmedLast = lastName.trim();
      const res = await api.patch<{ data: { firstName: string; lastName: string } }>(`/api/v1/users/${user.id}`, {
        firstName: trimmedFirst || undefined,
        lastName: trimmedLast || undefined,
      });

      const updatedName = `${res.data.firstName} ${res.data.lastName}`.trim();
      updateUserSession({ name: updatedName, firstName: res.data.firstName, lastName: res.data.lastName });
      await refreshUser();
      setProfileSuccess('Profile details saved successfully!');
    } catch (err: unknown) {
      setAvatarError(err instanceof ApiError ? err.message : 'Failed to update profile');
    } finally {
      setProfileSaving(false);
    }
  };

  // Handle password change
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (newPassword.length < 10) {
      setPasswordError('New password must be at least 10 characters long');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirmation do not match');
      return;
    }

    setPasswordBusy(true);

    try {
      await api.post('/api/v1/auth/change-password', {
        currentPassword: currentPassword || undefined,
        newPassword,
      });

      setPasswordSuccess('Your password has been updated successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      setPasswordError(err instanceof ApiError ? err.message : 'Failed to update password');
    } finally {
      setPasswordBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-settings-title"
    >
      <div className="flex flex-col w-full max-w-xl max-h-[90vh] bg-surface border border-line rounded-3xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand/15 text-brand border border-brand/20">
              <UserIcon className="h-5 w-5" />
            </div>
            <div>
              <h3 id="profile-settings-title" className="text-base font-bold text-ink">
                Profile & Account
              </h3>
              <p className="text-xs text-ink-muted">Manage your photo, account details and password</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="rounded-xl p-2 text-ink-muted hover:bg-raised hover:text-ink transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-line px-6 bg-canvas/40">
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            className={clsx(
              'flex items-center gap-2 py-3.5 px-4 text-xs font-semibold border-b-2 transition-colors',
              activeTab === 'profile'
                ? 'border-brand text-brand'
                : 'border-transparent text-ink-muted hover:text-ink'
            )}
          >
            <UserIcon className="h-4 w-4" />
            Profile Picture & Info
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('password')}
            className={clsx(
              'flex items-center gap-2 py-3.5 px-4 text-xs font-semibold border-b-2 transition-colors',
              activeTab === 'password'
                ? 'border-brand text-brand'
                : 'border-transparent text-ink-muted hover:text-ink'
            )}
          >
            <Lock className="h-4 w-4" />
            Change Password
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'profile' ? (
            <div className="space-y-6">
              {/* Profile Picture Card */}
              <div className="rounded-2xl border border-line bg-canvas p-5 space-y-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-ink-subtle">
                  Profile Picture
                </h4>

                {avatarError && (
                  <div className="flex items-center gap-2 p-3 text-xs text-danger bg-danger/10 border border-danger/20 rounded-xl">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{avatarError}</span>
                  </div>
                )}

                {profileSuccess && (
                  <div className="flex items-center gap-2 p-3 text-xs text-success bg-success/10 border border-success/20 rounded-xl">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>{profileSuccess}</span>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row items-center gap-5">
                  {/* Avatar Display */}
                  <div className="relative group">
                    <div className="relative flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl border-2 border-line bg-surface text-2xl font-bold text-brand overflow-hidden shadow-inner">
                      {user.avatarUrl && !avatarImgError ? (
                        /* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */
                        <img
                          src={user.avatarUrl}
                          alt={user.name}
                          className="h-full w-full object-cover"
                          onError={() => setAvatarImgError(true)}
                        />
                      ) : (
                        initialsOf(user.name)
                      )}
                      {avatarUploading && (
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white backdrop-blur-[2px]">
                          <Loader2 className="h-6 w-6 animate-spin" />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Upload Controls */}
                  <div className="flex-1 space-y-2 text-center sm:text-left">
                    <p className="text-xs font-semibold text-ink">Upload a new photo</p>
                    <p className="text-[11px] text-ink-muted leading-relaxed">
                      JPG, PNG, WebP or GIF. Maximum size 5 MB.
                    </p>

                    <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="hidden"
                        onChange={handleFileSelect}
                        disabled={avatarUploading}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={avatarUploading}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand hover:bg-brand-hover text-on-brand text-xs font-semibold transition-colors disabled:opacity-50 shadow-sm"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        {avatarUploading ? 'Uploading...' : 'Upload File'}
                      </button>

                      {user.avatarUrl && (
                        <button
                          type="button"
                          onClick={handleRemoveAvatar}
                          disabled={avatarUploading}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-line bg-surface hover:bg-danger/10 hover:border-danger/30 hover:text-danger text-ink-muted text-xs font-semibold transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Remove
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setShowUrlInput(!showUrlInput)}
                        className="text-xs text-brand hover:underline px-2 py-1"
                      >
                        {showUrlInput ? 'Cancel' : 'Enter Image URL'}
                      </button>
                    </div>

                    {showUrlInput && (
                      <form onSubmit={handleSaveAvatarUrl} className="pt-2 flex gap-2">
                        <input
                          type="url"
                          placeholder="https://example.com/photo.jpg"
                          value={customAvatarUrl}
                          onChange={(e) => setCustomAvatarUrl(e.target.value)}
                          className="flex-1 bg-surface border border-line rounded-xl px-3 py-1.5 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand"
                        />
                        <button
                          type="submit"
                          disabled={avatarUploading || !customAvatarUrl.trim()}
                          className="px-3 py-1.5 rounded-xl bg-brand text-on-brand text-xs font-semibold disabled:opacity-50"
                        >
                          Save URL
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              </div>

              {/* Personal Information Form */}
              <form onSubmit={handleSaveProfile} className="rounded-2xl border border-line bg-canvas p-5 space-y-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-ink-subtle">
                  Personal Information
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-ink">First Name</span>
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="Your first name"
                      maxLength={100}
                      className="w-full bg-surface border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand"
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-ink">Last Name</span>
                    <input
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Your last name"
                      maxLength={100}
                      className="w-full bg-surface border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand"
                    />
                  </label>
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-ink">Institutional Email</p>
                  <div className="flex items-center gap-2 bg-surface/60 border border-line/60 rounded-xl px-3 py-2 text-xs text-ink-muted">
                    <Mail className="h-4 w-4 text-ink-subtle shrink-0" />
                    <span className="truncate">{user.email}</span>
                    <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold text-success bg-success/15 px-2 py-0.5 rounded-full">
                      <CheckCircle2 className="h-3 w-3" />
                      Verified
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-line">
                  <div className="flex items-center gap-2 text-xs text-ink-muted">
                    <Building className="h-4 w-4 text-ink-subtle" />
                    <span>{user.tenantName || 'Institutional Tenant'}</span>
                    <span>•</span>
                    <span className="font-medium text-ink">{roleTitle(user.role)}</span>
                  </div>

                  <button
                    type="submit"
                    disabled={profileSaving}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand hover:bg-brand-hover text-on-brand text-xs font-bold transition-colors disabled:opacity-50"
                  >
                    {profileSaving ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      'Save Changes'
                    )}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            /* Change Password Form */
            <form onSubmit={handleChangePassword} className="rounded-2xl border border-line bg-canvas p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-brand" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-ink-subtle">
                  Update Account Password
                </h4>
              </div>

              <p className="text-xs text-ink-muted leading-relaxed">
                Choose a strong password to protect your institutional portal. Must be at least 10 characters long.
              </p>

              {passwordError && (
                <div className="flex items-center gap-2 p-3 text-xs text-danger bg-danger/10 border border-danger/20 rounded-xl">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{passwordError}</span>
                </div>
              )}

              {passwordSuccess && (
                <div className="flex items-center gap-2 p-3 text-xs text-success bg-success/10 border border-success/20 rounded-xl">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>{passwordSuccess}</span>
                </div>
              )}

              {/* Current Password */}
              <div className="space-y-1.5">
                <label htmlFor="profile-current-pwd" className="text-xs font-medium text-ink">
                  Current Password
                </label>
                <div className="relative">
                  <input
                    id="profile-current-pwd"
                    type={showCurrentPassword ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter your current password"
                    className="w-full bg-surface border border-line rounded-xl px-3 py-2 pr-10 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink"
                    aria-label={showCurrentPassword ? 'Hide password' : 'Show password'}
                  >
                    {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* New Password */}
              <div className="space-y-1.5">
                <label htmlFor="profile-new-pwd" className="text-xs font-medium text-ink">
                  New Password
                </label>
                <div className="relative">
                  <input
                    id="profile-new-pwd"
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 10 characters"
                    minLength={10}
                    required
                    className="w-full bg-surface border border-line rounded-xl px-3 py-2 pr-10 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink"
                    aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                  >
                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <div className="flex items-center gap-1.5 pt-1 text-[11px] text-ink-muted">
                  <span className={clsx(newPassword.length >= 10 ? 'text-success font-semibold' : 'text-ink-subtle')}>
                    ✓ 10+ characters
                  </span>
                </div>
              </div>

              {/* Confirm New Password */}
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-ink">Confirm New Password</span>
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                  required
                  className={clsx(
                    'w-full bg-surface border rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand',
                    confirmPassword && confirmPassword !== newPassword ? 'border-danger' : 'border-line'
                  )}
                />
                {confirmPassword && confirmPassword !== newPassword && (
                  <p className="text-[11px] text-danger">Passwords do not match</p>
                )}
              </label>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={passwordBusy || !newPassword || newPassword.length < 10 || newPassword !== confirmPassword}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand hover:bg-brand-hover text-on-brand text-xs font-bold transition-colors disabled:opacity-50 shadow-sm"
                >
                  {passwordBusy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Updating Password...
                    </>
                  ) : (
                    'Update Password'
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
