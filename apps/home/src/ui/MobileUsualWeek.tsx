/** The upstream timetable, laid out as readable day cards on a phone. */
import type { Child } from "../data/model";
import type { UsualDay } from "../data/schedule";
import { dayNameLong } from "../data/dates";
import { t } from "../i18n";
import { Icon, Tab } from "./bits";

interface Row {
  date: string;
  days: (UsualDay | undefined)[];
}

export function MobileUsualWeek({ children, rows, labelFor }: {
  children: Child[];
  rows: Row[];
  labelFor: (days: Row["days"]) => string | null;
}) {
  return (
    <div className="mobile-usual-week">
      {rows.map((row) => {
        const shared = labelFor(row.days);
        return (
          <section className="muw-day" key={row.date} aria-label={dayNameLong(row.date)}>
            <h2>{dayNameLong(row.date)}</h2>
            <dl>
              {children.map((child, i) => {
                const day = row.days[i];
                return (
                  <div className="muw-child" key={child.number}>
                    <dt><Tab child={child} full /></dt>
                    <dd>
                      {day ? <><time>{day.start}</time>–<time>{day.end}</time></> : t("No lessons")}
                      {day?.pe ? <span className="muw-pe"><Icon name="shirt" /> {t("PE")}</span> : null}
                    </dd>
                  </div>
                );
              })}
            </dl>
            {shared ? <p className="muw-shared">{shared}</p> : null}
          </section>
        );
      })}
    </div>
  );
}
