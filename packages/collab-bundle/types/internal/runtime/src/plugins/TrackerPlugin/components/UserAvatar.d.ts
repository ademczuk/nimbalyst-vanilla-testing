/**
 * UserAvatar -- renders an initials circle for tracker item owners/assignees.
 * Responsive: shows name text when wide, just initials circle when narrow.
 */
import React from 'react';
import type { TrackerIdentity } from '../../../core/DocumentService';
interface UserAvatarProps {
    /** TrackerIdentity object, email string, or display name string */
    identity: TrackerIdentity | string | null | undefined;
    /** Show name text next to the avatar (when there's room) */
    showName?: boolean;
    /** Size of the avatar circle in px */
    size?: number;
}
export declare const UserAvatar: React.FC<UserAvatarProps>;
export {};
