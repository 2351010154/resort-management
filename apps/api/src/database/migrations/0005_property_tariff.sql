CREATE TABLE "property_tariff" (
	"is_the_property" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"extra_person_per_night_gross" bigint NOT NULL,
	CONSTRAINT "property_tariff_holds_exactly_one_row" CHECK ("property_tariff"."is_the_property"),
	CONSTRAINT "property_tariff_extra_person_positive" CHECK ("property_tariff"."extra_person_per_night_gross" > 0)
);
