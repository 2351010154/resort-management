CREATE TABLE "system_config" (
	"is_the_configuration" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"vat_rate_bps" smallint NOT NULL,
	"reduced_vat_from" date,
	"reduced_vat_to" date,
	"vat_includes_service_charge" boolean NOT NULL,
	"service_charge_rate_bps" smallint NOT NULL,
	"business_date_rollover_hour" smallint NOT NULL,
	CONSTRAINT "system_config_holds_exactly_one_row" CHECK ("system_config"."is_the_configuration"),
	CONSTRAINT "system_config_vat_rate_within_bounds" CHECK ("system_config"."vat_rate_bps" between 0 and 10000),
	CONSTRAINT "system_config_service_charge_rate_within_bounds" CHECK ("system_config"."service_charge_rate_bps" between 0 and 10000),
	CONSTRAINT "system_config_rollover_hour_is_an_hour" CHECK ("system_config"."business_date_rollover_hour" between 0 and 23),
	CONSTRAINT "system_config_reduced_vat_window_opens_before_it_closes" CHECK ("system_config"."reduced_vat_from" is null or "system_config"."reduced_vat_to" is null
        or "system_config"."reduced_vat_to" >= "system_config"."reduced_vat_from")
);
