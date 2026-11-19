import { Injectable, inject } from '@angular/core';
import { ADMIN_SUPABASE } from '../core/supabase';
import { CourseDraft, TeeDraft } from './opengolf';

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
  owner_player_id: string | null;
}

/** The fields the Trip details form edits. */
export type TripFields = Omit<Trip, 'id' | 'status' | 'owner_player_id'>;

export interface RoundSummary {
  id: string;
  round_number: number;
  play_date: string;
  tee_time: string | null;
  status: 'scheduled' | 'live' | 'final';
  pairings_tbd: boolean;
  courses: { name: string; short_name: string | null } | null;
}

export interface RosterPlayer {
  id: string;
  name: string;
  initials: string;
  role: 'player' | 'co_admin';
  handicap_index: number | null;
  index_entered_at: string | null;
  sort_order: number;
  code: string | null;
  phone: string | null;
}

export interface SpectatorCode {
  id: string;
  code: string;
  enabled: boolean;
}

export interface CourseSummary {
  id: string;
  name: string;
  location: string | null;
  source: string;
  ratings_checked_at: string | null;
  tees: { id: string }[];
}

const TRIP_COLUMNS =
  'id, name, slug, location, start_date, end_date, status, theme, handicap_allowance, strokes_off_low, pickup_net_double, spectators_see_money, handicap_lock_date, owner_player_id';
const COURSE_COLUMNS =
  'id, name, short_name, location, architect, year_opened, description, website_url, scorecard_url, directions_url, photo_path, source, source_ref, ratings_checked_at';
const PHOTO_BUCKET = 'course-photos';

/** Thrown with a message fit to show the organizer. */
export class AdminError extends Error {}

function fail(error: { message: string; code?: string } | null, fallback: string): never {
  if (error?.code === '23505')
    throw new AdminError('That is already in use. Pick a different one.');
  if (error?.code === '23503')
    throw new AdminError("That's in use by a round, so it can't be removed.");
  throw new AdminError(fallback);
}

/** Everything the organizer screens read and write. All of it goes through RLS as the signed-in organizer. */
@Injectable({ providedIn: 'root' })
export class AdminData {
  private readonly db = inject(ADMIN_SUPABASE);

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

  async createTrip(fields: TripFields): Promise<Trip> {
    const { data, error } = await this.db
      .from('trips')
      .insert(fields)
      .select(TRIP_COLUMNS)
      .single();
    if (error) fail(error, "Couldn't create the trip.");
    return data as Trip;
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
        'id, round_number, play_date, tee_time, status, pairings_tbd, courses(name, short_name)',
      )
      .eq('trip_id', tripId)
      .order('round_number');
    if (error) fail(error, "Couldn't load the rounds.");
    return data as unknown as RoundSummary[];
  }

  // ── Roster ─────────────────────────────────────────────────────────────────

  async roster(tripId: string): Promise<RosterPlayer[]> {
    const { data, error } = await this.db
      .from('players')
      .select(
        'id, name, initials, role, handicap_index, index_entered_at, sort_order, player_codes(code), player_contacts(phone)',
      )
      .eq('trip_id', tripId)
      .order('sort_order')
      .order('name');
    if (error) fail(error, "Couldn't load the roster.");
    // player_codes and player_contacts are one-to-one, which comes back as an object (or an array on older servers).
    const one = <T>(value: T | T[] | null): T | null =>
      Array.isArray(value) ? (value[0] ?? null) : value;
    return (
      data as unknown as (RosterPlayer & { player_codes: unknown; player_contacts: unknown })[]
    ).map((row) => ({
      id: row.id,
      name: row.name,
      initials: row.initials,
      role: row.role,
      handicap_index: row.handicap_index,
      index_entered_at: row.index_entered_at,
      sort_order: row.sort_order,
      code: one(row.player_codes as { code: string } | null)?.code ?? null,
      phone: one(row.player_contacts as { phone: string } | null)?.phone ?? null,
    }));
  }

  /** Adds a player and issues their code. */
  async addPlayer(tripId: string, player: PlayerFields, sortOrder: number): Promise<void> {
    const { data, error } = await this.db
      .from('players')
      .insert({
        trip_id: tripId,
        name: player.name,
        initials: player.initials,
        handicap_index: player.handicap_index,
        sort_order: sortOrder,
      })
      .select('id')
      .single();
    if (error) fail(error, "Couldn't add the player.");
    const id = (data as { id: string }).id;
    await this.regenerateCode(id);
    await this.setPhone(id, player.phone);
  }

  async updatePlayer(id: string, player: PlayerFields): Promise<void> {
    const { error } = await this.db
      .from('players')
      .update({
        name: player.name,
        initials: player.initials,
        handicap_index: player.handicap_index,
      })
      .eq('id', id);
    if (error) fail(error, "Couldn't save the player.");
    await this.setPhone(id, player.phone);
  }

  async setRole(id: string, role: 'player' | 'co_admin'): Promise<void> {
    const { error } = await this.db.from('players').update({ role }).eq('id', id);
    if (error) fail(error, "Couldn't change the role.");
  }

  async regenerateCode(playerId: string): Promise<string> {
    const { data, error } = await this.db.rpc('regenerate_player_code', { p_player_id: playerId });
    if (error) fail(error, "Couldn't issue a code.");
    return data as string;
  }

  async replacePlayer(playerId: string, name: string, initials: string): Promise<string> {
    const { data, error } = await this.db.rpc('replace_player', {
      p_player_id: playerId,
      p_name: name,
      p_initials: initials,
    });
    if (error) fail(error, "Couldn't replace the player.");
    return data as string;
  }

  private async setPhone(playerId: string, phone: string | null): Promise<void> {
    const { error } = phone
      ? await this.db
          .from('player_contacts')
          .upsert({ player_id: playerId, phone, updated_at: new Date().toISOString() })
      : await this.db.from('player_contacts').delete().eq('player_id', playerId);
    if (error) fail(error, "Couldn't save the phone number.");
  }

  async spectatorCode(tripId: string): Promise<SpectatorCode | null> {
    const { data, error } = await this.db
      .from('spectator_codes')
      .select('id, code, enabled')
      .eq('trip_id', tripId)
      .order('created_at')
      .limit(1)
      .maybeSingle();
    if (error) fail(error, "Couldn't load the spectator code.");
    return data as SpectatorCode | null;
  }

  async issueSpectatorCode(tripId: string): Promise<void> {
    const { error } = await this.db.rpc('issue_spectator_code', { p_trip_id: tripId });
    if (error) fail(error, "Couldn't issue a spectator code.");
  }

  async setSpectatorEnabled(id: string, enabled: boolean): Promise<void> {
    const { error } = await this.db.from('spectator_codes').update({ enabled }).eq('id', id);
    if (error) fail(error, "Couldn't change the spectator code.");
  }

  // ── Course library ─────────────────────────────────────────────────────────

  async courses(): Promise<CourseSummary[]> {
    const { data, error } = await this.db
      .from('courses')
      .select('id, name, location, source, ratings_checked_at, tees(id)')
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

export interface PlayerFields {
  name: string;
  initials: string;
  handicap_index: number | null;
  phone: string | null;
}

export type { TeeDraft };
