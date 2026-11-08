export const STATION_PLOT_PRICE = 300;
export const STATION_BUILD_FEE = 40;
export const STATION_BUILD_WOOD = 40;
export const STATION_TANK_CAPACITY = 500;
export const STATION_UPGRADE = {cost: 350, wood: 30, rubber: 10, capacity: 1000};
export const STATION_MIN_PRICE = 1;
export const STATION_MAX_PRICE = 60;
export const STATION_PUMP_MAX_DURABILITY = 100;
export const STATION_WEAR_PER_LITRE = 0.18;
export const STATION_REPAIR_PER_RUBBER = 12;
export const STATION_SERVICE_MS = 9000;
export const DRIVERS_PER_CITY = 8;
export const DRIVER_STARTING_COINS = 90;
export const DRIVER_TARGET_COINS = 200;
export const DRIVER_FILL_LITRES = 3;
/** Cities pay drivers on a schedule so spending never stops when building stops. */
export const DRIVER_PAY_INTERVAL_MS = 30000;
export const DRIVER_PAY_PER_CYCLE = 6;
/** Starter grants always stay funded. Only coins above this help pay drivers. */
export const GRANT_RESERVE = 20000;
/** Each station sale pays a small city tax. Without it, one busy station could
 * take all fuel income and leave its mayor unable to buy deliveries from anyone. */
export const STATION_CITY_TAX = 0.1;
/** Drivers pay retail at a pump. Traders buy at the exchange. That gap is a station's margin. */
export const PUMP_MARKUP = 1.3;
export const DRIVER_CITY_FUEL_LITRES = 1;
export const DRIVER_IDLE_MS = 25000;
export const DRIVER_TRAVEL_SPEED = 6;
export const WAIT_COST_PER_CAR = 1.1;
export const DISTANCE_COST = 0.025;
export const LOYALTY_BONUS = 2;
export const DRIVER_VARIATION = 0.7;
export const PRICE_WAR_SHARE_THRESHOLD = 0.4;
export const PRICE_WAR_MAX_DISCOUNT = 0.25;
export const PRICE_CAP_DURATION_MS = 180000;
/** Session heartbeats acknowledge earnings; a brief grace avoids counting an
 * active player as away between polls or when a mobile tab briefly stalls. */
export const OFFLINE_SUMMARY_GRACE_MS = 15000;
