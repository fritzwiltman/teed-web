import { Injectable, inject } from '@angular/core';
import { Role } from '../core/session';
import { SUPABASE } from '../core/supabase';
import { CourseDraft, TeeDraft } from './opengolf';
import { ScoredGroup, hasScores } from '../core/round';

export type TripStatus = 'draft' | 'live' | 'final';

export interface Trip {
  id: string;
  name: string;
  slug: string;
  location: string | null;
  start_date: string;
  end_date: string;
  status: TripStatus;
  theme: string;
  handicap_allowance: number;
  strokes_off_low: boolean;
  pickup_net_double: boolean;
  spectators_see_money: boolean;
  handicap_lock_date: string | null;
  /** Where the trip is played (an IANA zone): a round's day ends at midnight there. */
  timezone: string;
}

/** The fields the Trip details form edits. */
export type TripFields = Omit<Trip, 'id' | 'status'>;

/** A course and its tees, for picking where a round is played. */
export interface CourseChoice {
  id: string;
  name: string;
  tees: {
    id: string;
    name: string;
    yards: number | null;
    rating: number | null;
    slope: number | null;
    par: number[];
  }[];
}

/** A round as its setup screen edits it. */
export interface RoundSetupFields {
  course_id: string;
  tee_id: string;
  holes: '18' | 'front' | 'back';
  play_date: string;
  tee_time: string | null;
  /** The group, in playing order. */
  player_ids: string[];
  nine_point: boolean;
  point_value_cents: number;
}

export interface RoundSetupRow extends RoundSetupFields {
  id: string;
  round_number: number;
  status: 'scheduled' | 'live' | 'final';
  /** Someone has a score in it. */
  scored: boolean;
}

export interface RoundSummary {
  id: string;
  round_number: number;
  play_date: string;
  tee_time: string | null;
  status: 'scheduled' | 'live' | 'final';
  pairings_tbd: boolean;
  courses: { name: string; short_name: string | null } | null;
  /** In play: someone has a score in it and it isn't final. */
  scored: boolean;
}

/** Someone on a trip, as trip_roster() gives them. */
export interface RosterPlayer {
  id: string;
  name: string;
  initials: string;
  role: Role;
  handicap_index: number | null;
  index_locked: boolean;
  buy_in_paid: boolean;
  sort_order: number;
  is_me: boolean;
  // The rest comes only to the organizer, co-organizers and the app admin.
  email?: string | null;
  phone?: string | null;
  /** Has signed in and taken their place. */
  claimed?: boolean;
  invited_at?: string | null;
  /** The "!" flags, from the data. */
  flags?: { no_email: boolean; not_claimed: boolean; not_paid: boolean };
}

/** What the caller is on a trip: 'admin' is the app admin on a trip they aren't a member of. */
export type TripRole = Role | 'admin';

/** Someone who may create trips, or has been invited to. */
export interface TripCreator {
  id: string;
  name: string;
  phone: string | null;
  claimed_at: string | null;
  email: string | null;
}

export interface CourseSummary {
  id: string;
  name: string;
  location: string | null;
  source: string;
  ratings_checked_at: string | null;
  tees: { id: string; stroke_index: number[] }[];
}

const TRIP_COLUMNS =
  'id, name, slug, location, start_date, end_date, status, theme, handicap_allowance, strokes_off_low, pickup_net_double, spectators_see_money, handicap_lock_date, timezone';
const COURSE_COLUMNS =
  'id, name, short_name, location, architect, year_opened, description, website_url, scorecard_url, directions_url, photo_path, source, source_ref, ratings_checked_at';
const PHOTO_BUCKET = 'course-photos';

/** Thrown with a message fit to show the organizer. */
export class AdminError extends Error {}

function fail(error: { message: string; code?: string } | null, fallback: string): never {
  // The database's own refusals to a round setup are written to be shown ("Add Dad's handicap index").
  if (error?.code === '23514' && error.message && !error.message.includes('violates'))
    throw new AdminError(error.message);
  if (error?.code === '23505')
    throw new AdminError('That is already in use. Pick a different one.');
  if (error?.code === '23503')
    throw new AdminError("That's in use by a round, so it can't be removed.");
  throw new AdminError(fallback);
}

/**
 * Everything the organizer screens read and write. All of it goes through RLS as whoever is
 * signed in: the database allows an organizer, a co-organizer and the app admin each what they
 * may do, and the screens hide the rest.
 */
@Injectable({ providedIn: 'root' })
export class AdminData {
  private readonly db = inject(SUPABASE);

  /** What the signed-in person is on this trip, or null when it isn't theirs to see. */
  async tripRole(tripId: string): Promise<TripRole | null> {
    const { data, error } = await this.db.rpc('trip_role', { p_trip_id: tripId });
    if (error) fail(error, "Couldn't load that trip.");
    return (data as TripRole | null) ?? null;
  }

  // ── Trips ──────────────────────────────────────────────────────────────────

  async trips(): Promise<Trip[]> {
    const { data, error } = await this.db
      .from('trips')
      .select(TRIP_COLUMNS)
      .order('start_date', { ascending: false });
    if (error) fail(error, "Couldn't load your trips.");
    return data as Trip[];
  }

  async trip(id: string): Promise<Trip> {
    const { data, error } = await this.db
      .from('trips')
      .select(TRIP_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error || !data) fail(error, "Couldn't load that trip.");
    return data as Trip;
  }

  /** Creates the trip (the creator becomes its organizer), then fills in the rest of its details. */
  async createTrip(fields: TripFields): Promise<Trip> {
    const { data, error } = await this.db.rpc('create_trip', {
      p_name: fields.name,
      p_slug: fields.slug,
      p_location: fields.location,
      p_start_date: fields.start_date,
      p_end_date: fields.end_date,
    });
    if (error) fail(error, "Couldn't create the trip.");
    return this.updateTrip(data as string, fields);
  }

  async deleteTrip(id: string): Promise<void> {
    const { data, error } = await this.db.from('trips').delete().eq('id', id).select('id');
    if (error || !data?.length) fail(error, "Couldn't delete the trip.");
  }

  async updateTrip(
    id: string,
    fields: Partial<TripFields> & { status?: TripStatus },
  ): Promise<Trip> {
    const { data, error } = await this.db
      .from('trips')
      .update(fields)
      .eq('id', id)
      .select(TRIP_COLUMNS)
      .single();
    if (error) fail(error, "Couldn't save the trip.");
    return data as Trip;
  }

  async rounds(tripId: string): Promise<RoundSummary[]> {
    const { data, error } = await this.db
      .from('rounds')
      .select(
        'id, round_number, play_date, tee_time, status, pairings_tbd, courses(name, short_name), groups(group_players(scores(count)))',
      )
      .eq('trip_id', tripId)
      .order('round_number');
    if (error) fail(error, "Couldn't load the rounds.");
    return (data as unknown as (RoundSummary & { groups: ScoredGroup[] })[]).map(
      ({ groups, ...round }) => ({
        ...round,
        scored: round.status !== 'final' && hasScores(groups),
      }),
    );
  }

  /** The library's courses that have tees, for the round setup's Course and Tees. */
  async courseChoices(): Promise<CourseChoice[]> {
    const { data, error } = await this.db
      .from('courses')
      .select('id, name, tees(id, name, yards, rating, slope, par)')
      .order('name');
    if (error) fail(error, "Couldn't load the course library.");
    return (data as unknown as CourseChoice[])
      .filter((c) => c.tees.length)
      .map((c) => ({ ...c, tees: [...c.tees].sort((a, b) => (b.yards ?? 0) - (a.yards ?? 0)) }));
  }

  /** One round, as its setup screen edits it. */
  async roundSetup(roundId: string): Promise<RoundSetupRow> {
    const { data, error } = await this.db
      .from('rounds')
      .select(
        'id, round_number, status, course_id, tee_id, holes, play_date, tee_time, round_formats(format_key, settings), groups(group_number, group_players(position, player_id, scores(count)))',
      )
      .eq('id', roundId)
      .maybeSingle();
    if (error || !data) fail(error, "Couldn't load that round.");
    const row = data as unknown as Omit<
      RoundSetupRow,
      'player_ids' | 'nine_point' | 'point_value_cents' | 'scored'
    > & {
      round_formats: { format_key: string; settings: Record<string, unknown> }[];
      groups: (ScoredGroup & { group_players: { position: number; player_id: string }[] })[];
    };
    const { round_formats, groups, ...round } = row;
    const nine = round_formats.find((f) => f.format_key === 'nine_point');
    return {
      ...round,
      player_ids: groups
        .flatMap((g) => g.group_players)
        .sort((a, b) => a.position - b.position)
        .map((gp) => gp.player_id),
      nine_point: !!nine,
      point_value_cents: Number(nine?.settings['point_value_cents']) || 0,
      scored: hasScores(groups),
    };
  }

  /** The point value the trip last played the 9-point game for, in cents. Null if it never has. */
  async lastPointValue(tripId: string): Promise<number | null> {
    const { data, error } = await this.db
      .from('rounds')
      .select('round_number, round_formats(format_key, settings)')
      .eq('trip_id', tripId)
      .order('round_number', { ascending: false });
    if (error) return null;
    for (const round of data as unknown as {
      round_formats: { format_key: string; settings: Record<string, unknown> }[];
    }[]) {
      const value = Number(
        round.round_formats.find((f) => f.format_key === 'nine_point')?.settings[
          'point_value_cents'
        ],
      );
      if (value > 0) return value;
    }
    return null;
  }

  /** Creates a round (no id) or changes one. Returns its id. */
  async saveRound(tripId: string, roundId: string | null, f: RoundSetupFields): Promise<string> {
    const { data, error } = await this.db.rpc('save_round', {
      p_trip_id: tripId,
      p_round_id: roundId,
      p_course_id: f.course_id,
      p_tee_id: f.tee_id,
      p_holes: f.holes,
      p_play_date: f.play_date,
      p_tee_time: f.tee_time,
      p_player_ids: f.player_ids,
      p_nine_point: f.nine_point,
      p_point_value_cents: f.nine_point ? f.point_value_cents : null,
    });
    if (error) fail(error, "Couldn't save the round.");
    return data as string;
  }

  async deleteRound(roundId: string): Promise<void> {
    const { error } = await this.db.rpc('delete_round', { p_round_id: roundId });
    if (error) fail(error, "Couldn't delete the round.");
  }

  // ── People ─────────────────────────────────────────────────────────────────

  async roster(tripId: string): Promise<RosterPlayer[]> {
    const { data, error } = await this.db.rpc('trip_roster', { p_trip_id: tripId });
    if (error) fail(error, "Couldn't load the people on this trip.");
    return data as RosterPlayer[];
  }

  /**
   * Adds someone to the trip. `token` is for their invite link; it is null when their email
   * already has an account, because then they are on the trip at once.
   */
  async addMember(
    tripId: string,
    member: MemberFields,
  ): Promise<{ id: string; token: string | null }> {
    const { data, error } = await this.db.rpc('add_member', {
      p_trip_id: tripId,
      p_name: member.name,
      p_email: member.email,
      p_role: member.role === 'co_organizer' ? 'co_organizer' : 'player',
      p_handicap_index: member.handicap_index,
      p_initials: member.initials,
    });
    if (error) fail(error, "Couldn't add them.");
    const added = data as { id: string; token: string | null };
    if (member.phone) await this.setPhone(added.id, member.phone);
    return added;
  }

  /** Saves what changed about someone. Their role and index go through the database's own rules. */
  async updateMember(current: RosterPlayer, member: MemberFields): Promise<void> {
    const row: Record<string, unknown> = { name: member.name, initials: member.initials };
    // Once someone has signed in, their email is the one they sign in with.
    if (!current.claimed && member.email !== (current.email ?? null)) row['email'] = member.email;
    const { error } = await this.db.from('trip_members').update(row).eq('id', current.id);
    if (error) fail(error, "Couldn't save that.");

    if (member.handicap_index !== current.handicap_index) {
      const { error: indexError } = await this.db.rpc('set_member_index', {
        p_member_id: current.id,
        p_handicap_index: member.handicap_index,
      });
      if (indexError) fail(indexError, "Couldn't save the handicap index.");
    }
    if (member.phone !== (current.phone ?? null)) await this.setPhone(current.id, member.phone);
    if (member.role !== current.role && current.role !== 'organizer' && member.role !== 'organizer')
      await this.setRole(current.id, member.role);
  }

  /** Player ↔ co-organizer. The organizer only. */
  async setRole(id: string, role: 'player' | 'co_organizer'): Promise<void> {
    const { error } = await this.db.rpc('set_member_role', { p_member_id: id, p_role: role });
    if (error) fail(error, "Couldn't change the role.");
  }

  /** A fresh invite link for someone who hasn't joined. The link sent before stops working. */
  async invite(memberId: string): Promise<string> {
    const { data, error } = await this.db.rpc('invite_member', { p_member_id: memberId });
    if (error) fail(error, "Couldn't make the invite link.");
    return data as string;
  }

  async removeMember(id: string): Promise<void> {
    const { data, error } = await this.db.from('trip_members').delete().eq('id', id).select('id');
    if (error || !data?.length) fail(error, "Couldn't remove them.");
  }

  private async setPhone(memberId: string, phone: string | null): Promise<void> {
    const { error } = phone
      ? await this.db
          .from('member_contacts')
          .upsert({ player_id: memberId, phone, updated_at: new Date().toISOString() })
      : await this.db.from('member_contacts').delete().eq('player_id', memberId);
    if (error) fail(error, "Couldn't save the phone number.");
  }

  /**
   * The trip's spectator link token: 'get' for the current one (null if none has been made),
   * 'reset' to make one or replace it, which stops the old link.
   */
  async spectatorToken(tripId: string, action: 'get' | 'reset'): Promise<string | null> {
    const { data, error } = await this.db.functions.invoke('spectator-link', {
      body: { trip_id: tripId, action },
    });
    if (error) fail(null, "Couldn't get the spectator link.");
    return (data as { token: string | null }).token;
  }

  // ── Trip creators (app admin) ──────────────────────────────────────────────

  async creators(): Promise<TripCreator[]> {
    const { data, error } = await this.db
      .from('trip_creators')
      .select('id, name, phone, claimed_at, profiles!trip_creators_profile_id_fkey(email)')
      .order('created_at');
    if (error) fail(error, "Couldn't load the trip creators.");
    return (data as unknown as (TripCreator & { profiles: { email: string } | null })[]).map(
      ({ profiles, ...creator }) => ({ ...creator, email: profiles?.email ?? null }),
    );
  }

  /** Adds someone who may create trips. Returns the token for their invite link. */
  async addCreator(name: string, phone: string | null): Promise<string> {
    const { data, error } = await this.db.rpc('add_trip_creator', { p_name: name, p_phone: phone });
    if (error) fail(error, "Couldn't add them.");
    return (data as { token: string }).token;
  }

  async inviteCreator(id: string): Promise<string> {
    const { data, error } = await this.db.rpc('invite_trip_creator', { p_creator_id: id });
    if (error) fail(error, "Couldn't make the invite link.");
    return data as string;
  }

  async removeCreator(id: string): Promise<void> {
    const { error } = await this.db.from('trip_creators').delete().eq('id', id);
    if (error) fail(error, "Couldn't remove them.");
  }

  // ── Course library ─────────────────────────────────────────────────────────

  async courses(): Promise<CourseSummary[]> {
    const { data, error } = await this.db
      .from('courses')
      .select('id, name, location, source, ratings_checked_at, tees(id, stroke_index)')
      .order('name');
    if (error) fail(error, "Couldn't load the course library.");
    return data as unknown as CourseSummary[];
  }

  async course(id: string): Promise<CourseDraft> {
    const { data, error } = await this.db
      .from('courses')
      .select(
        `${COURSE_COLUMNS}, tees(id, name, yards, rating, slope, par, stroke_index, hole_yards)`,
      )
      .eq('id', id)
      .maybeSingle();
    if (error || !data) fail(error, "Couldn't load that course.");
    const course = data as unknown as CourseDraft;
    course.tees.sort((a, b) => (b.yards ?? 0) - (a.yards ?? 0));
    return course;
  }

  /** Saves a course and its tees (new or existing). Returns the course id. */
  async saveCourse(draft: CourseDraft, removedTeeIds: string[] = []): Promise<string> {
    const { id, tees, ...fields } = draft;
    const saved = id
      ? await this.db.from('courses').update(fields).eq('id', id).select('id').single()
      : await this.db.from('courses').insert(fields).select('id').single();
    if (saved.error) {
      if (saved.error.code === '23505')
        throw new AdminError('That course is already in the library.');
      fail(saved.error, "Couldn't save the course.");
    }
    const courseId = (saved.data as { id: string }).id;

    for (const teeId of removedTeeIds) {
      const { error } = await this.db.from('tees').delete().eq('id', teeId);
      if (error) fail(error, "Couldn't remove a tee.");
    }
    for (const tee of tees) {
      const { id: teeId, ...teeFields } = tee;
      const { error } = teeId
        ? await this.db.from('tees').update(teeFields).eq('id', teeId)
        : await this.db.from('tees').insert({ ...teeFields, course_id: courseId });
      if (error) {
        if (error.code === '23505')
          throw new AdminError(`Two tees are both called ${tee.name}. Give each its own name.`);
        fail(error, `Couldn't save the ${tee.name} tee.`);
      }
    }
    return courseId;
  }

  /** Uploads an already-resized photo for a course and returns its storage path. */
  async uploadPhoto(courseId: string, photo: Blob): Promise<string> {
    const path = `${courseId}.jpg`;
    const { error } = await this.db.storage
      .from(PHOTO_BUCKET)
      .upload(path, photo, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
    if (error) throw new AdminError("Couldn't upload the photo.");
    const { error: saveError } = await this.db
      .from('courses')
      .update({ photo_path: path })
      .eq('id', courseId);
    if (saveError) fail(saveError, "Couldn't save the photo.");
    return path;
  }

  photoUrl(path: string | null): string | null {
    return path ? this.db.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl : null;
  }
}

export interface MemberFields {
  name: string;
  initials: string;
  email: string | null;
  phone: string | null;
  handicap_index: number | null;
  role: Role;
}
