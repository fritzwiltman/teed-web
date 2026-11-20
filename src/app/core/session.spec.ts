import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService, Me } from './auth';
import { MyTrip, SessionService } from './session';
import { SUPABASE } from './supabase';

const ME = { id: 'u1' } as Me;

const trip = (over: Partial<MyTrip>): MyTrip => ({
  id: 't1',
  name: 'Vero Beach 2027',
  status: 'live',
  location: 'Vero Beach, FL',
  start_date: '2027-01-11',
  end_date: '2027-01-15',
  stage: 'upcoming',
  bucket: 'next',
  role: 'player',
  member_id: 'm1',
  player_count: 4,
  finish: null,
  winnings: null,
  ...over,
});

describe('SessionService', () => {
  let me: ReturnType<typeof signal<Me | null>>;
  let myTrips: MyTrip[] | 'offline';
  let member: { id: string; name: string; initials: string; role: string } | null | 'offline';
  let rpc: ReturnType<typeof vi.fn>;

  function make(): SessionService {
    rpc = vi.fn(async () => {
      if (myTrips === 'offline') throw new TypeError('Failed to fetch');
      return { data: myTrips, error: null };
    });
    const from = () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (member === 'offline') throw new TypeError('Failed to fetch');
            return { data: member, error: null };
          },
        }),
      }),
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: SUPABASE, useValue: { rpc, from } },
        { provide: AuthService, useValue: { me } },
      ],
    });
    return TestBed.inject(SessionService);
  }

  beforeEach(() => {
    localStorage.clear();
    me = signal<Me | null>(ME);
    myTrips = [trip({})];
    member = { id: 'm1', name: 'Fritz', initials: 'FW', role: 'player' };
  });

  it('loads my trips and keeps them on the phone', async () => {
    const sessions = make();
    expect(await sessions.loadTrips()).toBe(true);
    expect(rpc).toHaveBeenCalledWith('my_trips');
    expect(sessions.trips().map((t) => t.name)).toEqual(['Vero Beach 2027']);
    expect(JSON.parse(localStorage.getItem('teed.trips')!)).toHaveLength(1);
  });

  it('opens one of my trips as who I am on it, and remembers it', async () => {
    myTrips = [trip({ role: 'co_organizer' })];
    const sessions = make();
    expect(await sessions.open('t1')).toBe(true);
    expect(sessions.session()).toEqual({
      trip: {
        id: 't1',
        name: 'Vero Beach 2027',
        status: 'live',
        location: 'Vero Beach, FL',
        start_date: '2027-01-11',
        end_date: '2027-01-15',
      },
      player: { id: 'm1', name: 'Fritz', initials: 'FW', role: 'co_organizer' },
    });
    expect(sessions.canManage()).toBe(true);
    expect(JSON.parse(localStorage.getItem('teed.session')!).trip.id).toBe('t1');
  });

  it('will not open a trip I am not on', async () => {
    const sessions = make();
    expect(await sessions.open('someone-elses')).toBe(false);
    expect(sessions.session()).toBeNull();
  });

  it('a player does not get the Manage pill', async () => {
    const sessions = make();
    await sessions.open('t1');
    expect(sessions.canManage()).toBe(false);
  });

  describe('where the app starts', () => {
    it('is the Home of a trip in progress, opening it', async () => {
      myTrips = [trip({ id: 't0', stage: 'upcoming' }), trip({ id: 't1', stage: 'in_progress' })];
      const sessions = make();
      expect(await sessions.startUrl()).toBe('/home');
      expect(sessions.session()?.trip.id).toBe('t1');
    });

    it('is You when nothing is in progress', async () => {
      const sessions = make();
      expect(await sessions.startUrl()).toBe('/you');
      expect(sessions.session()).toBeNull();
    });

    it('works with no signal from what the phone has saved', async () => {
      const first = make();
      myTrips = [trip({ stage: 'in_progress' })];
      await first.open('t1');
      TestBed.resetTestingModule();

      myTrips = 'offline';
      member = 'offline';
      const offline = make();
      expect(offline.session()?.trip.id).toBe('t1');
      expect(await offline.startUrl()).toBe('/home');
      expect(offline.session()?.player.name).toBe('Fritz');
    });
  });

  describe('checking with the server', () => {
    it('refreshes the open trip (published, a new role)', async () => {
      myTrips = [trip({ status: 'draft', stage: 'draft', role: 'co_organizer' })];
      const sessions = make();
      await sessions.open('t1');
      myTrips = [trip({ status: 'live', role: 'organizer' })];
      await sessions.revalidate();
      expect(sessions.session()?.trip.status).toBe('live');
      expect(sessions.session()?.player.role).toBe('organizer');
    });

    it('closes the trip when I have been taken off it', async () => {
      const sessions = make();
      await sessions.open('t1');
      myTrips = [];
      await sessions.revalidate();
      expect(sessions.session()).toBeNull();
      expect(localStorage.getItem('teed.session')).toBeNull();
    });

    it('changes nothing with no connection', async () => {
      const sessions = make();
      await sessions.open('t1');
      myTrips = 'offline';
      await sessions.revalidate();
      expect(sessions.session()?.trip.id).toBe('t1');
    });
  });

  it('going back to You closes the trip but keeps my list', async () => {
    const sessions = make();
    await sessions.open('t1');
    sessions.leave();
    expect(sessions.session()).toBeNull();
    expect(sessions.trips()).toHaveLength(1);
  });

  it('signing out forgets my trips on this phone', async () => {
    const sessions = make();
    await sessions.open('t1');
    me.set(null);
    TestBed.tick();
    expect(sessions.session()).toBeNull();
    expect(sessions.trips()).toEqual([]);
    expect(localStorage.getItem('teed.session')).toBeNull();
    expect(localStorage.getItem('teed.trips')).toBeNull();
  });
});
