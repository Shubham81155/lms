/**
 * Enterprise Virtual Classroom & Live Collaboration Engine
 * Manages WebRTC Room Topology, Breakout Sessions, and Live Polling State
 */

export interface ClassroomParticipant {
  id: string;
  name: string;
  role: 'HOST' | 'CO_HOST' | 'PRESENTER' | 'LEARNER';
  isMuted: boolean;
  isVideoEnabled: boolean;
  isHandRaised: boolean;
  breakoutRoomId?: string;
}

export interface BreakoutRoom {
  id: string;
  name: string;
  participantIds: string[];
  durationMinutes: number;
  isOpen: boolean;
}

export interface LivePoll {
  id: string;
  question: string;
  options: { id: string; text: string; votes: number }[];
  isOpen: boolean;
  totalVotes: number;
}

export class VirtualClassroomSession {
  public sessionId: string;
  public courseId: string;
  public title: string;
  public participants: Map<string, ClassroomParticipant> = new Map();
  public breakoutRooms: Map<string, BreakoutRoom> = new Map();
  public activePoll: LivePoll | null = null;
  public isRecording = false;

  constructor(sessionId: string, courseId: string, title: string) {
    this.sessionId = sessionId;
    this.courseId = courseId;
    this.title = title;
  }

  public join(participant: ClassroomParticipant): void {
    this.participants.set(participant.id, participant);
  }

  public leave(participantId: string): void {
    this.participants.delete(participantId);
  }

  public createBreakoutRooms(roomCount: number, durationMinutes: number): BreakoutRoom[] {
    this.breakoutRooms.clear();
    const rooms: BreakoutRoom[] = [];
    const learnerIds = Array.from(this.participants.values())
      .filter((p) => p.role === 'LEARNER')
      .map((p) => p.id);

    for (let i = 1; i <= roomCount; i++) {
      const room: BreakoutRoom = {
        id: `br_${this.sessionId}_${i}`,
        name: `Breakout Room ${i}`,
        participantIds: [],
        durationMinutes,
        isOpen: true,
      };
      this.breakoutRooms.set(room.id, room);
      rooms.push(room);
    }

    // Distribute learners evenly across breakout rooms
    learnerIds.forEach((id, index) => {
      const targetRoom = rooms[index % roomCount];
      targetRoom.participantIds.push(id);
      const participant = this.participants.get(id);
      if (participant) {
        participant.breakoutRoomId = targetRoom.id;
      }
    });

    return rooms;
  }

  public launchPoll(question: string, optionTexts: string[]): LivePoll {
    this.activePoll = {
      id: `poll_${Date.now()}`,
      question,
      options: optionTexts.map((text, idx) => ({ id: `opt_${idx}`, text, votes: 0 })),
      isOpen: true,
      totalVotes: 0,
    };
    return this.activePoll;
  }

  public submitVote(optionId: string): boolean {
    if (!this.activePoll || !this.activePoll.isOpen) return false;
    const opt = this.activePoll.options.find((o) => o.id === optionId);
    if (opt) {
      opt.votes += 1;
      this.activePoll.totalVotes += 1;
      return true;
    }
    return false;
  }
}
